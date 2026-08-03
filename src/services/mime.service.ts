import { fileTypeFromFile } from 'file-type';
import path from 'node:path';

export interface MimeInspectionResult {
  filePath: string;
  originalExtension: string;
  detectedExtension?: string;
  mimeType?: string;
  needsFix: boolean;
  proposedPath?: string;
}

export class MimeService {
  /** Map of standard extensions to their normalized representation */
  private static extensionEquivalents: Record<string, string[]> = {
    jpg: ['jpeg', 'jpg'],
    jpeg: ['jpg', 'jpeg'],
    tif: ['tiff', 'tif'],
    tiff: ['tif', 'tiff'],
    heic: ['heif', 'heic'],
    heif: ['heic', 'heif'],
    mp4: ['m4v', 'mp4'],
  };

  /**
   * Inspects a file's magic bytes to detect if its extension mismatches its true format.
   */
  static async inspectFile(filePath: string): Promise<MimeInspectionResult> {
    const extWithDot = path.extname(filePath).toLowerCase();
    const ext = extWithDot.replace(/^\./, '');

    try {
      const detected = await fileTypeFromFile(filePath);
      if (!detected) {
        return {
          filePath,
          originalExtension: extWithDot,
          needsFix: false,
        };
      }

      const detectedExt = detected.ext.toLowerCase();
      const detectedMime = detected.mime;

      // Check if original extension is equivalent
      const equivalents = this.extensionEquivalents[ext] || [ext];
      const isMatch = equivalents.includes(detectedExt);

      if (!isMatch && detectedExt) {
        const parsed = path.parse(filePath);
        const proposedPath = path.join(parsed.dir, `${parsed.name}.${detectedExt}`);
        return {
          filePath,
          originalExtension: extWithDot,
          detectedExtension: `.${detectedExt}`,
          mimeType: detectedMime,
          needsFix: true,
          proposedPath,
        };
      }

      return {
        filePath,
        originalExtension: extWithDot,
        detectedExtension: `.${detectedExt}`,
        mimeType: detectedMime,
        needsFix: false,
      };
    } catch {
      return {
        filePath,
        originalExtension: extWithDot,
        needsFix: false,
      };
    }
  }
}
