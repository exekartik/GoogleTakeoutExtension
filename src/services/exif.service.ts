import { exiftool, ExifDateTime } from 'exiftool-vendored';
import { GeoCoordinates } from '../models/media-entity.js';

export interface ExifReadResult {
  dateTaken?: Date;
  coordinates?: GeoCoordinates;
  cameraModel?: string;
}

/**
 * ============================================================================
 * EXIF METADATA SERVICE
 * ============================================================================
 *
 * WHY THIS SERVICE EXISTS:
 * Reading and writing metadata (EXIF/XMP/IPTC) across hundreds of different
 * camera formats (.JPG, .HEIC, .MP4, .DNG) is extremely difficult in pure Node.js.
 *
 * WHAT THIS DOES:
 * This wrapper uses `exiftool-vendored`, which spawns a highly-optimized,
 * persistent background C/Perl daemon process of Phil Harvey's ExifTool.
 *
 * By keeping a single daemon running, we avoid the massive overhead of booting
 * the ExifTool binary for every single file.
 */
export class ExifService {
  /**
   * Reads metadata (timestamps, GPS, camera model) directly from a media file's header.
   * This is used in Step 4 (Extract Dates) as a high-accuracy fallback when
   * Google Takeout JSON sidecars are missing.
   *
   * @param filePath The absolute path to the media file on disk.
   */
  static async readMetadata(filePath: string): Promise<ExifReadResult> {
    try {
      const tags = await exiftool.read(filePath);
      const result: ExifReadResult = {};

      // Parse dates hierarchically: DateTimeOriginal (Photo taken) > CreateDate (Digitized) > ModifyDate
      const rawDate: unknown = tags.DateTimeOriginal || tags.CreateDate || tags.ModifyDate;
      if (rawDate) {
        if (
          typeof rawDate === 'object' &&
          rawDate !== null &&
          'toDate' in rawDate &&
          typeof (rawDate as { toDate: () => Date }).toDate === 'function'
        ) {
          result.dateTaken = (rawDate as { toDate: () => Date }).toDate();
        } else if (typeof rawDate === 'string') {
          const parsed = new Date(rawDate);
          if (!isNaN(parsed.getTime())) {
            result.dateTaken = parsed;
          }
        }
      }

      // Parse GPS Coordinates if available
      if (typeof tags.GPSLatitude === 'number' && typeof tags.GPSLongitude === 'number') {
        result.coordinates = {
          latitude: tags.GPSLatitude,
          longitude: tags.GPSLongitude,
          altitude: typeof tags.GPSAltitude === 'number' ? tags.GPSAltitude : undefined,
        };
      }

      // Parse Camera Model for debugging or advanced organization
      if (tags.Model) {
        result.cameraModel = String(tags.Model);
      }

      return result;
    } catch {
      // Return empty if file is corrupt or has no EXIF
      return {};
    }
  }

  /**
   * Embeds recovered timestamps, GPS coordinates, and captions directly into a media
   * file's EXIF tags. Used in Step 7.
   *
   * @param filePath The absolute path to the media file on disk.
   * @param metadata The structured metadata to embed into the file header.
   */
  static async writeMetadata(
    filePath: string,
    metadata: {
      dateTaken?: Date;
      coordinates?: GeoCoordinates;
      description?: string;
    },
  ): Promise<boolean> {
    try {
      const tagsToWrite: Record<string, unknown> = {};

      // Convert standard JS Date to ExifTool's proprietary ExifDateTime format
      if (metadata.dateTaken) {
        const exifDate = ExifDateTime.fromMillis(metadata.dateTaken.getTime());
        if (exifDate) {
          // Write to all standard date tags for maximum compatibility across software
          tagsToWrite.DateTimeOriginal = exifDate;
          tagsToWrite.CreateDate = exifDate;
          tagsToWrite.ModifyDate = exifDate;
        }
      }

      // Embed GPS Coordinates
      if (metadata.coordinates) {
        tagsToWrite.GPSLatitude = metadata.coordinates.latitude;
        tagsToWrite.GPSLongitude = metadata.coordinates.longitude;
        if (metadata.coordinates.altitude !== undefined) {
          tagsToWrite.GPSAltitude = metadata.coordinates.altitude;
        }
      }

      // Embed User Caption / Description
      if (metadata.description) {
        tagsToWrite.ImageDescription = metadata.description;
        tagsToWrite.Description = metadata.description;
      }

      // Skip if nothing to write
      if (Object.keys(tagsToWrite).length === 0) {
        return true;
      }

      // Execute write via daemon process. `-overwrite_original` prevents ExifTool
      // from creating duplicate backup files (e.g. photo.jpg_original).
      await exiftool.write(filePath, tagsToWrite, ['-overwrite_original']);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Safely terminates the background ExifTool daemon process.
   * Must be called at the very end of the pipeline to prevent memory leaks
   * or hanging processes in the OS.
   */
  static async close(): Promise<void> {
    try {
      await exiftool.end();
    } catch {
      // Ignored
    }
  }
}
