import fs from 'node:fs/promises';
import path from 'node:path';
import { ProcessingStep, StepResult } from './base-step.js';
import { ProcessingContext } from '../core/context.js';
import { ExtensionFixingMode } from '../core/config.js';
import { MimeService } from '../services/mime.service.js';
import { ConcurrencyService } from '../services/concurrency.service.js';

/**
 * ============================================================================
 * STEP 1: FIX MISMATCHED FILE EXTENSIONS
 * ============================================================================
 *
 * WHY THIS STEP IS WRITTEN:
 * Google Takeout exports often contain files with incorrect file extensions
 * (e.g. a file named `photo.heic` that is actually a JPEG image, or `video.mp4`
 * that is actually an AVI clip). This causes media players, EXIF readers, and
 * OS photo galleries to fail or display corrupt icons.
 *
 * WHAT THIS STEP DOES:
 * 1. Recursively scans the input Google Takeout folder.
 * 2. Inspects magic bytes (header signatures) of every media file via `MimeService`.
 * 3. If a file extension doesn't match its true MIME type, renames the file
 *    to its correct extension (e.g. `photo.heic` -> `photo.jpg`).
 * 4. Simultaneously renames any paired `.json` metadata sidecar (e.g. `photo.heic.json` -> `photo.jpg.json`).
 */
export class FixExtensionsStep extends ProcessingStep {
  readonly stepNumber = 1;
  readonly name = 'Fix Mismatched File Extensions';

  /**
   * Determines if this step should be skipped based on user configuration.
   */
  override shouldSkip(context: ProcessingContext): boolean {
    return context.config.extensionFixing === ExtensionFixingMode.NONE;
  }

  /**
   * Executes the extension repair routine across all media files in the input directory.
   */
  async run(
    context: ProcessingContext,
  ): Promise<Omit<StepResult, 'stepNumber' | 'stepName' | 'durationMs'>> {
    let fixedCount = 0;

    // Obtain shared concurrency queue to avoid hitting OS open file limits (EMFILE)
    const limit = ConcurrencyService.getLimit();

    // Supported extensions to check against magic byte signatures
    const mediaExtensions = new Set([
      '.jpg',
      '.jpeg',
      '.png',
      '.heic',
      '.heif',
      '.webp',
      '.gif',
      '.mp4',
      '.mov',
      '.avi',
      '.m4v',
      '.mkv',
      '.dng',
      '.raw',
    ]);

    /**
     * Recursive directory scanner that inspects and renames files.
     */
    async function scanAndFix(currentDir: string): Promise<void> {
      let entries;
      try {
        entries = await fs.readdir(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      const tasks: Promise<void>[] = [];

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          // Recurse into subdirectories
          tasks.push(scanAndFix(fullPath));
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();

          if (mediaExtensions.has(ext)) {
            // Queue file inspection with concurrency limit
            tasks.push(
              limit(async () => {
                // Read magic bytes from file header
                const inspection = await MimeService.inspectFile(fullPath);

                if (inspection.needsFix && inspection.proposedPath) {
                  try {
                    // Rename the media file to its true extension
                    await fs.rename(fullPath, inspection.proposedPath);
                    fixedCount++;

                    // Check and rename paired Google Takeout JSON sidecar if it exists
                    const oldJson = `${fullPath}.json`;
                    const newJson = `${inspection.proposedPath}.json`;
                    try {
                      await fs.access(oldJson);
                      await fs.rename(oldJson, newJson);
                    } catch {
                      // No JSON sidecar present for this file
                    }
                  } catch {
                    // Handle file lock or permission exceptions gracefully
                  }
                }
              }),
            );
          }
        }
      }

      await Promise.all(tasks);
    }

    // Start recursive scan from Takeout root folder
    await scanAndFix(context.config.inputPath);

    return {
      isSuccess: true,
      message: `Checked file extensions. Corrected ${fixedCount} mismatched files.`,
      data: { extensionsFixed: fixedCount },
    };
  }
}
