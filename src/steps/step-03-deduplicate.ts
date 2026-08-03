import path from 'node:path';
import { ProcessingStep, StepResult } from './base-step.js';
import { ProcessingContext } from '../core/context.js';
import { MediaEntity, FileEntity } from '../models/media-entity.js';
import { HashService } from '../services/hash.service.js';
import { ConcurrencyService } from '../services/concurrency.service.js';

/**
 * ============================================================================
 * STEP 3: DEDUPLICATE & MERGE MEDIA ENTITIES
 * ============================================================================
 *
 * WHY THIS STEP IS WRITTEN:
 * Google Takeout creates physical duplicates of the same photo whenever a photo
 * appears in both a Year folder (e.g. `Photos from 2023`) and one or more User Albums
 * (e.g. `Trip 2023`, `Favorites`). This inflates disk usage dramatically.
 *
 * In addition, Apple Live Photos and Google Motion Photos consist of two files:
 * a still image (`.HEIC`/`.JPG`) and a short video clip (`.MOV`/`.MP4`).
 *
 * WHAT THIS STEP DOES:
 * 1. Computes streaming SHA-256 content hashes for all discovered media files.
 * 2. Groups files with matching hashes into a single canonical `MediaEntity`.
 * 3. Records album memberships from duplicate physical files so no album tags are lost.
 * 4. Detects and pairs Live Photo image and video files sharing the same base filename.
 * 5. Populates `context.mediaEntities`.
 */
export class DeduplicateStep extends ProcessingStep {
  readonly stepNumber = 3;
  readonly name = 'Deduplicate & Merge Media Entities';

  private static readonly YEAR_FOLDER_REGEX =
    /^(?:Photos from|Fotos del|Fotos von|Foto da|Foto_s van|Photos de|Zdjęcia z)\s+(\d{4})$/i;

  async run(
    context: ProcessingContext,
  ): Promise<Omit<StepResult, 'stepNumber' | 'stepName' | 'durationMs'>> {
    context.mediaEntities.clear();
    const limit = ConcurrencyService.getLimit();

    // Map contentHash -> MediaEntity
    const hashMap = new Map<string, MediaEntity>();

    // Map "dirPath/baseNameNoExt" -> { image?, video? } for Live Photo pairing
    const livePhotoCandidates = new Map<string, { image?: FileEntity; video?: FileEntity }>();

    // Step 1: Compute hashes in parallel using bounded CPU queue
    const hashingTasks = context.discoveredFiles.map((file) =>
      limit(async () => {
        try {
          const hash = await HashService.computeFileHash(file.path);
          return { file, hash };
        } catch {
          return null;
        }
      }),
    );

    const results = await Promise.all(hashingTasks);

    // Step 2: Merge duplicate physical files into canonical MediaEntities
    for (const res of results) {
      if (!res) continue;
      const { file, hash } = res;

      const parentDir = path.basename(path.dirname(file.path));
      const isYearFolder = DeduplicateStep.YEAR_FOLDER_REGEX.test(parentDir);
      let albumName: string | undefined;

      if (!isYearFolder) {
        albumName = parentDir;
      }

      let entity = hashMap.get(hash);
      if (!entity) {
        // Create new primary MediaEntity
        entity = new MediaEntity(file, hash);
        if (isYearFolder) entity.yearFolder = parentDir;
        if (albumName) entity.addAlbum(albumName);
        hashMap.set(hash, entity);
      } else {
        // Merge duplicate file copy into existing MediaEntity
        entity.addDuplicate(file);
        if (albumName) entity.addAlbum(albumName);
        if (isYearFolder && !entity.yearFolder) entity.yearFolder = parentDir;

        // If primary file had no JSON sidecar, check if this duplicate copy has one
        if (!entity.primaryFile.jsonCompanionPath && file.jsonCompanionPath) {
          entity.primaryFile.jsonCompanionPath = file.jsonCompanionPath;
        }
      }

      // Track potential Live Photo pairings (matching base name in same directory)
      const dirPath = path.dirname(file.path);
      const parsed = path.parse(file.path);
      const key = `${dirPath}/${parsed.name}`.toLowerCase();

      const candidate = livePhotoCandidates.get(key) || {};
      const imageExts = new Set(['.heic', '.heif', '.jpg', '.jpeg']);
      const videoExts = new Set(['.mov', '.mp4']);

      if (imageExts.has(file.extension)) {
        candidate.image = file;
      } else if (videoExts.has(file.extension)) {
        candidate.video = file;
      }
      livePhotoCandidates.set(key, candidate);
    }

    // Step 3: Pair Live Photo images with their companion video clips
    let livePhotosCount = 0;
    for (const candidate of livePhotoCandidates.values()) {
      if (candidate.image && candidate.video) {
        for (const entity of hashMap.values()) {
          if (entity.primaryFile.path === candidate.image.path) {
            entity.isLivePhoto = true;
            entity.pairedVideoFile = candidate.video;
            livePhotosCount++;
            break;
          }
        }
      }
    }

    context.mediaEntities = hashMap;

    let duplicateFilesCount = 0;
    for (const entity of hashMap.values()) {
      duplicateFilesCount += entity.duplicateFiles.length;
    }

    return {
      isSuccess: true,
      message: `Consolidated ${context.discoveredFiles.length} files into ${hashMap.size} unique media entities (${duplicateFilesCount} duplicates merged, ${livePhotosCount} Live Photos paired).`,
      data: {
        uniqueMediaCount: hashMap.size,
        duplicatesRemoved: duplicateFilesCount,
        livePhotosPaired: livePhotosCount,
      },
    };
  }
}
