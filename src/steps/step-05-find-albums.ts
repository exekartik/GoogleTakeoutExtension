import { ProcessingStep, StepResult } from './base-step.js';
import { ProcessingContext } from '../core/context.js';

/**
 * ============================================================================
 * STEP 5: FIND & NORMALIZE ALBUMS
 * ============================================================================
 *
 * WHY THIS STEP IS WRITTEN:
 * User album names in Google Photos can contain special characters (such as `/`, `\`, `:`,
 * `*`, `?`, `"`, `<`, `>`, `|`, emoji, leading/trailing spaces or dots) that are
 * illegal on Windows or POSIX filesystems.
 *
 * WHAT THIS STEP DOES:
 * 1. Collects all unique album folder names attached to media entities.
 * 2. Filters out special system folders (`Trash`, `Archive`, `Locked Folder`).
 * 3. Normalizes Unicode characters (NFC form) and replaces invalid OS characters.
 * 4. Stores sanitized `AlbumEntity` instances in `context.albums`.
 */
export class FindAlbumsStep extends ProcessingStep {
  readonly stepNumber = 5;
  readonly name = 'Find & Normalize Albums';

  /** Regex for invalid OS filesystem characters */
  // eslint-disable-next-line no-control-regex
  private static readonly ILLEGAL_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;

  /** Folder names that should not be converted into user album folders */
  private static readonly IGNORE_ALBUM_NAMES = new Set([
    'archive',
    'trash',
    'locked folder',
    'bin',
    'corbeille',
    'papierkorb',
    'papelera',
    'lixeira',
    'archivio',
    'cestino',
    'prullenbak',
    'kosz',
    'untitled',
    'unknown',
    'sin título',
    'sem título',
  ]);

  /**
   * Cleans and normalizes raw album folder names into cross-platform filesystem safe strings.
   */
  static sanitizeAlbumName(rawName: string): string {
    return rawName
      .normalize('NFC')
      .replace(FindAlbumsStep.ILLEGAL_CHARS, '_')
      .replace(/[.\s]+$/, '') // Strip trailing spaces or dots (invalid on Windows)
      .trim();
  }

  async run(
    context: ProcessingContext,
  ): Promise<Omit<StepResult, 'stepNumber' | 'stepName' | 'durationMs'>> {
    context.albums.clear();

    for (const entity of context.mediaEntities.values()) {
      for (const rawAlbum of entity.albums) {
        const normalized = FindAlbumsStep.sanitizeAlbumName(rawAlbum);
        const lower = normalized.toLowerCase();

        if (normalized.length === 0 || FindAlbumsStep.IGNORE_ALBUM_NAMES.has(lower)) {
          continue;
        }

        let albumEntity = context.albums.get(normalized);
        if (!albumEntity) {
          albumEntity = {
            name: rawAlbum,
            normalizedName: normalized,
            mediaIds: new Set(),
          };
          context.albums.set(normalized, albumEntity);
        }

        albumEntity.mediaIds.add(entity.id);
      }
    }

    return {
      isSuccess: true,
      message: `Identified and normalized ${context.albums.size} unique user albums.`,
      data: {
        albumsCount: context.albums.size,
        albumNames: Array.from(context.albums.keys()),
      },
    };
  }
}
