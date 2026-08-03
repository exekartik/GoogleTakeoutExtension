import fs from 'node:fs/promises';
import path from 'node:path';
import { ProcessingStep, StepResult } from './base-step.js';
import { ProcessingContext } from '../core/context.js';
import { AlbumBehavior, DateDivision } from '../core/config.js';
import { ConcurrencyService } from '../services/concurrency.service.js';

/**
 * ============================================================================
 * STEP 6: ORGANIZE & MOVE FILES TO OUTPUT LIBRARY
 * ============================================================================
 *
 * WHY THIS STEP IS WRITTEN:
 * This is the primary file-moving stage of the pipeline. It constructs the clean,
 * organized directory layout chosen by the user (`ALL_PHOTOS/` + `Albums/`).
 *
 * WHAT THIS STEP DOES:
 * 1. Creates date subfolders in `ALL_PHOTOS/` (`YYYY/`, `YYYY/MM/`, or flat).
 * 2. Copies/moves primary media files into their designated date subfolder.
 * 3. Resolves filename collisions automatically (e.g. `IMG_001_1.jpg`).
 * 4. Also moves paired Live Photo video companions (`.MOV`/`.MP4`).
 * 5. Executes the chosen Album Strategy:
 *    - `shortcut` (Default): Creates symlinks/hardlinks in `Albums/<Name>/` pointing to `ALL_PHOTOS/`.
 *    - `duplicate-copy`: Physically copies files into `Albums/<Name>/`.
 *    - `json`: Generates a lightweight `albums.json` index without copying files.
 *    - `reverse-shortcut` / `raw`.
 */
export class MoveFilesStep extends ProcessingStep {
  readonly stepNumber = 6;
  readonly name = 'Organize & Move Files to Output';

  /**
   * Constructs the date subfolder path based on the selected DateDivision option.
   */
  static getDateSubfolder(date: Date, division: DateDivision): string {
    if (
      division === DateDivision.NONE ||
      !date ||
      isNaN(date.getTime()) ||
      date.getFullYear() <= 1970
    ) {
      return '';
    }

    const yyyy = String(date.getUTCFullYear());
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');

    switch (division) {
      case DateDivision.YEAR:
        return yyyy;
      case DateDivision.YEAR_MONTH:
        return path.join(yyyy, mm);
      case DateDivision.DAY:
        return path.join(yyyy, mm, dd);
      default:
        return '';
    }
  }

  /**
   * Ensures target filename does not overwrite an existing file by appending a counter.
   */
  static async getUniqueTargetFilePath(targetDir: string, fileName: string): Promise<string> {
    const parsed = path.parse(fileName);
    let candidate = path.join(targetDir, fileName);
    let counter = 1;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        await fs.access(candidate);
        // File exists, append counter (e.g. photo_1.jpg)
        candidate = path.join(targetDir, `${parsed.name}_${counter}${parsed.ext}`);
        counter++;
      } catch {
        // File path is free and safe to write
        return candidate;
      }
    }
  }

  async run(
    context: ProcessingContext,
  ): Promise<Omit<StepResult, 'stepNumber' | 'stepName' | 'durationMs'>> {
    const limit = ConcurrencyService.getLimit();
    const { outputPath, albumBehavior, dateDivision, allPhotosDirName, hardlink, dryRun } =
      context.config;

    const allPhotosBaseDir = path.join(outputPath, allPhotosDirName);
    const albumsBaseDir = path.join(outputPath, 'Albums');

    if (!dryRun) {
      await fs.mkdir(allPhotosBaseDir, { recursive: true });
      if (albumBehavior !== AlbumBehavior.RAW && albumBehavior !== AlbumBehavior.JSON) {
        await fs.mkdir(albumsBaseDir, { recursive: true });
      }
    }

    let filesMoved = 0;
    let shortcutsCreated = 0;
    const albumPlaylists: Record<string, string[]> = {};

    const tasks = Array.from(context.mediaEntities.values()).map((entity) =>
      limit(async () => {
        // Determine destination folder inside ALL_PHOTOS
        const dateSubfolder = MoveFilesStep.getDateSubfolder(entity.dateTaken, dateDivision);
        const destDir = dateSubfolder
          ? path.join(allPhotosBaseDir, dateSubfolder)
          : allPhotosBaseDir;

        if (!dryRun) {
          await fs.mkdir(destDir, { recursive: true });
        }

        // Get collision-free target file path
        const primaryTarget = await MoveFilesStep.getUniqueTargetFilePath(
          destDir,
          entity.primaryFile.name,
        );
        entity.targetOutputPath = primaryTarget;

        if (!dryRun) {
          // Copy primary file
          await fs.copyFile(entity.primaryFile.path, primaryTarget);

          // Move paired Live Photo video companion if present
          if (entity.isLivePhoto && entity.pairedVideoFile) {
            const videoExt = entity.pairedVideoFile.extension;
            const parsedPrimary = path.parse(primaryTarget);
            const videoTarget = path.join(destDir, `${parsedPrimary.name}${videoExt}`);
            await fs.copyFile(entity.pairedVideoFile.path, videoTarget);
          }
        }
        filesMoved++;

        // Process user album memberships
        for (const rawAlbum of entity.albums) {
          const sanitizedAlbum = rawAlbum
            .normalize('NFC')
            // eslint-disable-next-line no-control-regex
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
            .trim();
          if (!sanitizedAlbum) continue;

          const albumDir = path.join(albumsBaseDir, sanitizedAlbum);

          if (albumBehavior === AlbumBehavior.JSON) {
            if (!albumPlaylists[sanitizedAlbum]) albumPlaylists[sanitizedAlbum] = [];
            albumPlaylists[sanitizedAlbum].push(primaryTarget);
          } else if (albumBehavior === AlbumBehavior.DUPLICATE_COPY) {
            if (!dryRun) {
              await fs.mkdir(albumDir, { recursive: true });
              const albumTarget = await MoveFilesStep.getUniqueTargetFilePath(
                albumDir,
                path.basename(primaryTarget),
              );
              await fs.copyFile(primaryTarget, albumTarget);
            }
            shortcutsCreated++;
          } else if (albumBehavior === AlbumBehavior.SHORTCUT) {
            if (!dryRun) {
              await fs.mkdir(albumDir, { recursive: true });
              const linkPath = path.join(albumDir, path.basename(primaryTarget));
              try {
                if (hardlink && process.platform === 'win32') {
                  await fs.link(primaryTarget, linkPath);
                } else {
                  const relativeTarget = path.relative(albumDir, primaryTarget);
                  await fs.symlink(relativeTarget, linkPath, 'file');
                }
                shortcutsCreated++;
              } catch {
                // Fallback to physical copy if OS blocks symlink creation
                try {
                  await fs.copyFile(primaryTarget, linkPath);
                  shortcutsCreated++;
                } catch {
                  // Ignored
                }
              }
            }
          }
        }
      }),
    );

    await Promise.all(tasks);

    // Save album index JSON if json mode was selected
    if (albumBehavior === AlbumBehavior.JSON && !dryRun) {
      const albumsJsonPath = path.join(outputPath, 'albums.json');
      await fs.writeFile(albumsJsonPath, JSON.stringify(albumPlaylists, null, 2), 'utf-8');
    }

    return {
      isSuccess: true,
      message: `Organized ${filesMoved} media files into library (${shortcutsCreated} album links created).`,
      data: {
        filesMoved,
        shortcutsCreated,
        albumStrategy: albumBehavior,
      },
    };
  }
}
