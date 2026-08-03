import path from 'node:path';
import { ProcessingStep, StepResult } from './base-step.js';
import { ProcessingContext } from '../core/context.js';
import { DateAccuracy } from '../models/date-accuracy.js';
import { JsonMatcherService } from '../services/json-matcher.service.js';
import { ExifService } from '../services/exif.service.js';
import { ConcurrencyService } from '../services/concurrency.service.js';

/**
 * ============================================================================
 * STEP 4: EXTRACT DATES & MATCH METADATA (4-TIER FALLBACK)
 * ============================================================================
 *
 * WHY THIS STEP IS WRITTEN:
 * When downloading Google Photos via Takeout, file creation timestamps on disk
 * reset to the download date (e.g. today). Furthermore, WhatsApp, social media,
 * or edited photos often have missing or stripped EXIF headers.
 *
 * To guarantee every single photo gets its accurate historical date, this step
 * executes a 4-tier confidence fallback strategy:
 *
 * Tier 1: Google JSON sidecar (`photoTakenTime` / `creationTime` timestamp) -> Highest Accuracy (JSON)
 * Tier 2: EXIF Header metadata (`DateTimeOriginal` / `CreateDate`)       -> High Accuracy (EXIF)
 * Tier 3: Filename Regex parsing (`IMG_20230514_143000.jpg`)             -> Medium Accuracy (FILENAME)
 * Tier 4: Takeout Year Folder name (`Photos from 2021`)                 -> Basic Accuracy (FOLDER_YEAR)
 * Tier 5: Fallback to filesystem mtime                                   -> Low Accuracy (NONE)
 */
export class ExtractDatesStep extends ProcessingStep {
  readonly stepNumber = 4;
  readonly name = 'Extract Dates & Match Metadata';

  /** Regex patterns for extracting dates from common filename formats */
  private static readonly FILENAME_PATTERNS = [
    // Standard Camera: IMG_20230514_143022, PXL_20230514_143022, VID_20230514_143022
    /(?:IMG|PXL|VID|WP|SAVE|PHOTO)_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/i,
    // Raw numeric timestamp: 20230514_143022
    /(?:^|[^\d])(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})(?:[^\d]|$)/,
    // WhatsApp format: WhatsApp Image 2023-05-14 at 14.30.22
    /(\d{4})-(\d{2})-(\d{2})(?:[ _at]+)(\d{2})[.\-_](\d{2})[.\-_](\d{2})/,
    // Date only format: 2023-05-14
    /(\d{4})[-_](\d{2})[-_](\d{2})/,
  ];

  async run(
    context: ProcessingContext,
  ): Promise<Omit<StepResult, 'stepNumber' | 'stepName' | 'durationMs'>> {
    const limit = ConcurrencyService.getLimit();
    const stats = {
      json: 0,
      exif: 0,
      filename: 0,
      folderYear: 0,
      fallback: 0,
    };

    const tasks = Array.from(context.mediaEntities.values()).map((entity) =>
      limit(async () => {
        // TIER 1: Check Google Takeout JSON sidecar
        if (entity.primaryFile.jsonCompanionPath) {
          const jsonMeta = await JsonMatcherService.parseJsonMetadata(
            entity.primaryFile.jsonCompanionPath,
          );
          if (jsonMeta) {
            if (jsonMeta.photoTakenTime) {
              entity.dateTaken = jsonMeta.photoTakenTime;
              entity.dateAccuracy = DateAccuracy.JSON;
              stats.json++;
            } else if (jsonMeta.creationTime) {
              entity.dateTaken = jsonMeta.creationTime;
              entity.dateAccuracy = DateAccuracy.JSON;
              stats.json++;
            }
            if (jsonMeta.coordinates) {
              entity.coordinates = jsonMeta.coordinates;
            }
            if (jsonMeta.title) entity.title = jsonMeta.title;
            if (jsonMeta.description) entity.description = jsonMeta.description;

            if (entity.dateAccuracy === DateAccuracy.JSON) return;
          }
        }

        // TIER 2: Read EXIF metadata from file header
        const exif = await ExifService.readMetadata(entity.primaryFile.path);
        if (
          exif.dateTaken &&
          !isNaN(exif.dateTaken.getTime()) &&
          exif.dateTaken.getFullYear() > 1970
        ) {
          entity.dateTaken = exif.dateTaken;
          entity.dateAccuracy = DateAccuracy.EXIF;
          if (exif.coordinates && !entity.coordinates) {
            entity.coordinates = exif.coordinates;
          }
          stats.exif++;
          return;
        }

        // TIER 3: Parse date from filename patterns
        const filename = path.basename(entity.primaryFile.path);
        for (const pattern of ExtractDatesStep.FILENAME_PATTERNS) {
          const match = filename.match(pattern);
          if (match) {
            const year = parseInt(match[1], 10);
            const month = parseInt(match[2], 10) - 1;
            const day = parseInt(match[3], 10);
            const hour = match[4] ? parseInt(match[4], 10) : 12;
            const minute = match[5] ? parseInt(match[5], 10) : 0;
            const second = match[6] ? parseInt(match[6], 10) : 0;

            if (
              year >= 1970 &&
              year <= 2100 &&
              month >= 0 &&
              month <= 11 &&
              day >= 1 &&
              day <= 31
            ) {
              entity.dateTaken = new Date(Date.UTC(year, month, day, hour, minute, second));
              entity.dateAccuracy = DateAccuracy.FILENAME;
              stats.filename++;
              return;
            }
          }
        }

        // TIER 4: Extract year from Takeout Year folder (e.g. "Photos from 2021")
        if (entity.yearFolder) {
          const yearMatch = entity.yearFolder.match(/\b(19\d\d|20\d\d)\b/);
          if (yearMatch) {
            const year = parseInt(yearMatch[1], 10);
            entity.dateTaken = new Date(Date.UTC(year, 0, 1, 12, 0, 0));
            entity.dateAccuracy = DateAccuracy.FOLDER_YEAR;
            stats.folderYear++;
            return;
          }
        }

        // TIER 5: Fallback to filesystem modified timestamp
        if (entity.primaryFile.fileModifiedTime) {
          entity.dateTaken = entity.primaryFile.fileModifiedTime;
        } else {
          entity.dateTaken = new Date();
        }
        entity.dateAccuracy = DateAccuracy.NONE;
        stats.fallback++;
      }),
    );

    await Promise.all(tasks);

    return {
      isSuccess: true,
      message: `Extracted dates: ${stats.json} from JSON, ${stats.exif} from EXIF, ${stats.filename} from Filename, ${stats.folderYear} from Year Folder.`,
      data: stats,
    };
  }
}
