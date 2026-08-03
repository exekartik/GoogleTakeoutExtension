import { ProcessingStep, StepResult } from './base-step.js';
import { ProcessingContext } from '../core/context.js';
import { ExifService } from '../services/exif.service.js';
import { ConcurrencyService } from '../services/concurrency.service.js';

/**
 * ============================================================================
 * STEP 7: WRITE EXIF & GPS METADATA INTO MEDIA HEADERS
 * ============================================================================
 *
 * WHY THIS STEP IS WRITTEN:
 * Google Takeout provides timestamps, GPS coordinates, and captions inside separate
 * `.json` sidecar files. Most photo software (Apple Photos, Lightroom, Google Photos)
 * ignores `.json` sidecars and reads metadata directly from EXIF image headers.
 *
 * WHAT THIS STEP DOES:
 * 1. Iterates over all organized media files in the output library.
 * 2. Writes recovered date taken (`DateTimeOriginal`, `CreateDate`) into EXIF tags.
 * 3. Writes recovered GPS coordinates (`GPSLatitude`, `GPSLongitude`, `GPSAltitude`).
 * 4. Writes captions/descriptions into `ImageDescription` tags.
 * 5. Uses a persistent ExifTool daemon process (`exiftool-vendored`) for maximum speed.
 */
export class WriteExifStep extends ProcessingStep {
  readonly stepNumber = 7;
  readonly name = 'Write EXIF & GPS Metadata';

  override shouldSkip(context: ProcessingContext): boolean {
    return !context.config.writeExif || context.config.dryRun;
  }

  async run(
    context: ProcessingContext,
  ): Promise<Omit<StepResult, 'stepNumber' | 'stepName' | 'durationMs'>> {
    const limit = ConcurrencyService.getLimit();
    let writtenCount = 0;
    let gpsWrittenCount = 0;

    const tasks = Array.from(context.mediaEntities.values()).map((entity) =>
      limit(async () => {
        if (!entity.targetOutputPath) return;

        const hasValidDate =
          entity.dateTaken &&
          !isNaN(entity.dateTaken.getTime()) &&
          entity.dateTaken.getFullYear() > 1970;
        const hasCoordinates = !!entity.coordinates;
        const hasDescription = !!entity.description;

        if (!hasValidDate && !hasCoordinates && !hasDescription) return;

        // Embed metadata into physical file EXIF header
        const success = await ExifService.writeMetadata(entity.targetOutputPath, {
          dateTaken: hasValidDate ? entity.dateTaken : undefined,
          coordinates: entity.coordinates,
          description: entity.description,
        });

        if (success) {
          writtenCount++;
          if (hasCoordinates) gpsWrittenCount++;
        }
      }),
    );

    await Promise.all(tasks);

    return {
      isSuccess: true,
      message: `Embedded metadata into ${writtenCount} files (${gpsWrittenCount} with GPS coordinates).`,
      data: {
        exifMetadataWritten: writtenCount,
        gpsCoordinatesWritten: gpsWrittenCount,
      },
    };
  }
}
