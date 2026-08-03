import fs from 'node:fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { ProcessingStep, StepResult } from './base-step.js';
import { ProcessingContext } from '../core/context.js';
import { ConcurrencyService } from '../services/concurrency.service.js';

const execAsync = promisify(exec);

/**
 * ============================================================================
 * STEP 8: UPDATE FILE SYSTEM CREATION TIMESTAMPS
 * ============================================================================
 *
 * WHY THIS STEP IS WRITTEN:
 * When files are extracted from a ZIP or moved on disk, operating systems (Windows Explorer,
 * macOS Finder) update the file's `Date Created` / `Date Modified` attribute to the current moment.
 * This breaks sorting by date in file explorers.
 *
 * WHAT THIS STEP DOES:
 * 1. Synchronizes file modification time (`mtime`) and access time (`atime`) via `fs.utimes`.
 * 2. On Windows, executes PowerShell commands to explicitly set `CreationTime` (`btime`)
 *    so Windows Explorer displays accurate photo dates in the "Date" column.
 */
export class UpdateCreationTimeStep extends ProcessingStep {
  readonly stepNumber = 8;
  readonly name = 'Update File System Creation Timestamps';

  override shouldSkip(context: ProcessingContext): boolean {
    return !context.config.updateCreationTime || context.config.dryRun;
  }

  async run(
    context: ProcessingContext,
  ): Promise<Omit<StepResult, 'stepNumber' | 'stepName' | 'durationMs'>> {
    const limit = ConcurrencyService.getLimit();
    let updatedCount = 0;

    const isWindows = process.platform === 'win32';

    const tasks = Array.from(context.mediaEntities.values()).map((entity) =>
      limit(async () => {
        if (!entity.targetOutputPath) return;
        if (
          !entity.dateTaken ||
          isNaN(entity.dateTaken.getTime()) ||
          entity.dateTaken.getFullYear() <= 1970
        ) {
          return;
        }

        try {
          // Update atime and mtime across all OSes
          await fs.utimes(entity.targetOutputPath, entity.dateTaken, entity.dateTaken);

          // On Windows, explicitly update CreationTime using PowerShell
          if (isWindows) {
            try {
              const formattedDate = entity.dateTaken.toISOString();
              const escapedPath = entity.targetOutputPath.replace(/'/g, "''");
              await execAsync(
                `powershell -NoProfile -Command "(Get-Item -LiteralPath '${escapedPath}').CreationTime = [DateTime]'${formattedDate}'"`,
              );
            } catch {
              // Graceful fallback if PowerShell is disabled or restricted
            }
          }

          updatedCount++;
        } catch {
          // Ignored
        }
      }),
    );

    await Promise.all(tasks);

    return {
      isSuccess: true,
      message: `Updated OS timestamps on ${updatedCount} files.`,
      data: { timestampsUpdated: updatedCount },
    };
  }
}
