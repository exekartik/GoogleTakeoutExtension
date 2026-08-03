import path from 'node:path';

export enum AlbumBehavior {
  /** Move files to ALL_PHOTOS, create symlinks/hardlinks in album folders */
  SHORTCUT = 'shortcut',
  /** Copy files physically to album folders (uses more disk space) */
  DUPLICATE_COPY = 'duplicate-copy',
  /** Move files to ALL_PHOTOS and generate an albums.json index/playlist */
  JSON = 'json',
  /** Place files inside Album folders, create shortcuts in ALL_PHOTOS */
  REVERSE_SHORTCUT = 'reverse-shortcut',
  /** Move files exclusively into Album folders (non-album photos stay in ALL_PHOTOS) */
  ALBUM_ONLY = 'album-only',
  /** Flat chronological directory without creating album folders */
  RAW = 'raw',
}

export enum DateDivision {
  /** Flat output folder without date subfolders */
  NONE = 'none',
  /** Group into year folders (e.g., 2023/) */
  YEAR = 'year',
  /** Group into year/month folders (e.g., 2023/05/) */
  YEAR_MONTH = 'year-month',
  /** Group into year/month/day folders (e.g., 2023/05/24/) */
  DAY = 'day',
}

export enum ExtensionFixingMode {
  /** Skip extension fixing */
  NONE = 'none',
  /** Fix extensions based on magic bytes, skipping TIFF (standard) */
  STANDARD = 'standard',
  /** Conservative mode: skip TIFF and JPEG */
  CONSERVATIVE = 'conservative',
  /** Solo mode: fix extensions and exit immediately without moving */
  SOLO = 'solo',
}

export interface ProcessingConfig {
  /** Input Google Takeout root folder path */
  inputPath: string;
  /** Output organized library folder path */
  outputPath: string;
  /** Album organization strategy */
  albumBehavior: AlbumBehavior;
  /** Date folder hierarchy */
  dateDivision: DateDivision;
  /** Whether to write metadata (dates, GPS, tags) to EXIF headers */
  writeExif: boolean;
  /** Extension fixing strategy */
  extensionFixing: ExtensionFixingMode;
  /** Whether to synchronize OS file creation time */
  updateCreationTime: boolean;
  /** Use hard links instead of symlinks on Windows (same NTFS drive required) */
  hardlink: boolean;
  /** Custom name for non-album photos folder (default: 'ALL_PHOTOS') */
  allPhotosDirName: string;
  /** Whether to preserve duplicate files in a '_Duplicates' folder */
  keepDuplicates: boolean;
  /** Disable reading previous progress.json and force fresh run */
  disableResume: boolean;
  /** Verbose debug logging */
  verbose: boolean;
  /** Dry run: simulate without modifying or moving files */
  dryRun: boolean;
}

export const DEFAULT_CONFIG: ProcessingConfig = {
  inputPath: '',
  outputPath: '',
  albumBehavior: AlbumBehavior.SHORTCUT,
  dateDivision: DateDivision.NONE,
  writeExif: true,
  extensionFixing: ExtensionFixingMode.STANDARD,
  updateCreationTime: process.platform === 'win32',
  hardlink: false,
  allPhotosDirName: 'ALL_PHOTOS',
  keepDuplicates: false,
  disableResume: false,
  verbose: false,
  dryRun: false,
};

export function cleanPath(rawPath: string): string {
  if (!rawPath) return '';
  let cleaned = rawPath.trim();
  // Remove surrounding single or double quotes commonly added by drag-and-drop
  cleaned = cleaned.replace(/^['"]+|['"]+$/g, '').trim();
  return path.resolve(cleaned);
}

export function validateConfig(config: ProcessingConfig): void {
  config.inputPath = cleanPath(config.inputPath);
  config.outputPath = cleanPath(config.outputPath);

  if (!config.inputPath || config.inputPath.length === 0) {
    throw new Error('Input path is required and cannot be empty.');
  }
  if (!config.outputPath || config.outputPath.length === 0) {
    throw new Error('Output path is required and cannot be empty.');
  }
  if (config.inputPath === config.outputPath) {
    throw new Error('Input path and Output path cannot be the same directory.');
  }
}
