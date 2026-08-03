import fs from 'node:fs/promises';
import path from 'node:path';
import { ProcessingStep, StepResult } from './base-step.js';
import { ProcessingContext } from '../core/context.js';
import { FileEntity } from '../models/media-entity.js';
import { JsonMatcherService } from '../services/json-matcher.service.js';

/**
 * ============================================================================
 * STEP 2: DISCOVER MEDIA & CLASSIFY TAKE-OUT FOLDERS
 * ============================================================================
 *
 * WHY THIS STEP IS WRITTEN:
 * Google Takeout exports combine user photos from multiple sources:
 * - Year archives (e.g. `Photos from 2023`, `Fotos del 2022`)
 * - User-created albums (e.g. `Trip to Japan`, `Family Reunion`)
 * - Special system folders (e.g. `Trash`, `Locked Folder`, `Archive`)
 *
 * In addition, Google creates `.json` metadata sidecars for every photo.
 * This step traverses the filesystem to find every media file, classify
 * its parent folder, and link it to its corresponding `.json` sidecar.
 *
 * WHAT THIS STEP DOES:
 * 1. Recursively traverses the input Takeout directory.
 * 2. Matches folder names against multilingual Year Folder patterns and Special Folders.
 * 3. Discovers all media files (JPEG, PNG, HEIC, MP4, MOV, DNG, RAW, etc.).
 * 4. Links each media file to its companion `.json` metadata sidecar file.
 * 5. Stores raw discovered files in `context.discoveredFiles`.
 */
export class DiscoverMediaStep extends ProcessingStep {
  readonly stepNumber = 2;
  readonly name = 'Discover Media & Classify Folders';

  /**
   * Multilingual Regex for Google Takeout Year Folders:
   * Matches "Photos from 2023", "Fotos del 2022", "Fotos von 2021", etc.
   */
  private static readonly YEAR_FOLDER_REGEX =
    /^(?:Photos from|Fotos del|Fotos von|Foto da|Foto_s van|Photos de|Zdjęcia z)\s+(\d{4})$/i;

  /** Special Google Takeout folders to exclude from becoming user albums */
  private static readonly SPECIAL_FOLDERS = new Set([
    'locked folder',
    'carpeta privada',
    'archive',
    'trash',
    'archivo',
    'papelera',
    'arquivo',
    'lixeira',
    'archivio',
    'cestino',
    'corbeille',
    'archiv',
    'papierkorb',
    'archief',
    'prullenbak',
    'kosz',
    'archiwum',
  ]);

  /** Complete list of supported photo and video extensions */
  private static readonly MEDIA_EXTENSIONS = new Set([
    '.jpg',
    '.jpeg',
    '.png',
    '.heic',
    '.heif',
    '.webp',
    '.gif',
    '.bmp',
    '.tiff',
    '.tif',
    '.mp4',
    '.mov',
    '.avi',
    '.m4v',
    '.mkv',
    '.3gp',
    '.wmv',
    '.webm',
    '.dng',
    '.cr2',
    '.nef',
    '.arw',
    '.rw2',
    '.orf',
    '.mp',
    '.mv',
  ]);

  async run(
    context: ProcessingContext,
  ): Promise<Omit<StepResult, 'stepNumber' | 'stepName' | 'durationMs'>> {
    // Reset state before discovery
    context.discoveredFiles = [];
    context.yearFolders.clear();
    context.specialFolders.clear();

    const discovered: FileEntity[] = [];

    /**
     * Traverses directories recursively to locate media and sidecar JSONs.
     */
    async function walk(currentDir: string): Promise<void> {
      let dirEntries;
      try {
        dirEntries = await fs.readdir(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      const folderName = path.basename(currentDir);
      const lowerFolder = folderName.toLowerCase().trim();

      // Classify directory type
      if (DiscoverMediaStep.YEAR_FOLDER_REGEX.test(folderName)) {
        context.yearFolders.add(folderName);
      } else if (DiscoverMediaStep.SPECIAL_FOLDERS.has(lowerFolder)) {
        context.specialFolders.add(folderName);
      }

      // Pre-collect all JSON sidecar files in the current folder for fast matching
      const jsonFiles = dirEntries
        .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.json'))
        .map((e) => path.join(currentDir, e.name));

      for (const entry of dirEntries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          // Recurse into child directories
          await walk(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();

          if (DiscoverMediaStep.MEDIA_EXTENSIONS.has(ext)) {
            const stat = await fs.stat(fullPath);

            // Find matching JSON sidecar (handles 47-char truncation & duplicate (1).json naming)
            const companionJson = await JsonMatcherService.findCompanionJson(fullPath, jsonFiles);

            discovered.push({
              path: fullPath,
              name: entry.name,
              extension: ext,
              size: stat.size,
              jsonCompanionPath: companionJson || undefined,
              fileModifiedTime: stat.mtime,
            });
          }
        }
      }
    }

    // Begin directory traversal from input root
    await walk(context.config.inputPath);
    context.discoveredFiles = discovered;

    return {
      isSuccess: true,
      message: `Discovered ${discovered.length} media files across folders.`,
      data: {
        totalFilesDiscovered: discovered.length,
        yearFoldersCount: context.yearFolders.size,
        specialFoldersCount: context.specialFolders.size,
      },
    };
  }
}
