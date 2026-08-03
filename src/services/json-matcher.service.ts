import fs from 'node:fs/promises';
import path from 'node:path';
import { GeoCoordinates } from '../models/media-entity.js';

export interface GoogleJsonMetadata {
  title?: string;
  description?: string;
  photoTakenTime?: Date;
  creationTime?: Date;
  coordinates?: GeoCoordinates;
}

export class JsonMatcherService {
  /**
   * Finds candidate Google Takeout JSON sidecar files for a given media file in its directory.
   */
  static async findCompanionJson(
    mediaFilePath: string,
    directoryJsonFiles?: string[],
  ): Promise<string | null> {
    const dir = path.dirname(mediaFilePath);
    const mediaFileName = path.basename(mediaFilePath); // e.g. "IMG_001.jpg"
    const parsed = path.parse(mediaFilePath);
    const baseNameWithoutExt = parsed.name; // e.g. "IMG_001"
    const ext = parsed.ext; // e.g. ".jpg"

    // 1. Direct standard patterns:
    const standardCandidates = [
      path.join(dir, `${mediaFileName}.json`), // IMG_001.jpg.json
      path.join(dir, `${baseNameWithoutExt}.json`), // IMG_001.json
    ];

    // Check for Takeout's duplicate number quirk: "photo(1).jpg" -> "photo.jpg(1).json"
    const dupMatch = baseNameWithoutExt.match(/^(.*)\((\d+)\)$/);
    if (dupMatch) {
      const root = dupMatch[1];
      const num = dupMatch[2];
      standardCandidates.push(
        path.join(dir, `${root}${ext}(${num}).json`),
        path.join(dir, `${root}(${num})${ext}.json`),
      );
    }

    // Check for edited quirk: "photo-edited.jpg" -> "photo.jpg.json"
    if (baseNameWithoutExt.endsWith('-edited')) {
      const originalBase = baseNameWithoutExt.replace(/-edited$/, '');
      standardCandidates.push(
        path.join(dir, `${originalBase}${ext}.json`),
        path.join(dir, `${originalBase}.json`),
      );
    }

    for (const candidate of standardCandidates) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // Candidate not found, continue
      }
    }

    // 2. Truncated filename resolution:
    // Takeout truncates names around 47-51 chars
    let jsonFiles = directoryJsonFiles;
    if (!jsonFiles) {
      try {
        const entries = await fs.readdir(dir);
        jsonFiles = entries
          .filter((f) => f.toLowerCase().endsWith('.json'))
          .map((f) => path.join(dir, f));
      } catch {
        return null;
      }
    }

    if (jsonFiles && jsonFiles.length > 0) {
      const cleanMediaName = mediaFileName.toLowerCase();
      for (const jsonPath of jsonFiles) {
        const jsonBase = path
          .basename(jsonPath)
          .replace(/\.json$/i, '')
          .toLowerCase();
        if (jsonBase.length >= 10 && cleanMediaName.startsWith(jsonBase)) {
          return jsonPath;
        }
      }
    }

    return null;
  }

  /**
   * Parses Google Takeout JSON sidecar and extracts timestamps, coordinates, and descriptions.
   */
  static async parseJsonMetadata(jsonPath: string): Promise<GoogleJsonMetadata | null> {
    try {
      const content = await fs.readFile(jsonPath, 'utf-8');
      const data = JSON.parse(content);

      const result: GoogleJsonMetadata = {};

      if (typeof data.title === 'string' && data.title.trim().length > 0) {
        result.title = data.title.trim();
      }
      if (typeof data.description === 'string' && data.description.trim().length > 0) {
        result.description = data.description.trim();
      }

      // Extract photoTakenTime
      if (data.photoTakenTime?.timestamp) {
        const seconds = parseInt(String(data.photoTakenTime.timestamp), 10);
        if (!isNaN(seconds) && seconds > 0) {
          result.photoTakenTime = new Date(seconds * 1000);
        }
      }

      // Extract creationTime fallback
      if (data.creationTime?.timestamp) {
        const seconds = parseInt(String(data.creationTime.timestamp), 10);
        if (!isNaN(seconds) && seconds > 0) {
          result.creationTime = new Date(seconds * 1000);
        }
      }

      // Extract Geo Coordinates
      const geo = data.geoData || data.geoDataExif;
      if (geo && typeof geo.latitude === 'number' && typeof geo.longitude === 'number') {
        if (geo.latitude !== 0 || geo.longitude !== 0) {
          result.coordinates = {
            latitude: geo.latitude,
            longitude: geo.longitude,
            altitude: typeof geo.altitude === 'number' ? geo.altitude : undefined,
          };
        }
      }

      return result;
    } catch {
      return null;
    }
  }
}
