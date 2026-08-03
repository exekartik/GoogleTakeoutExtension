import { DateAccuracy } from './date-accuracy.js';

export interface GeoCoordinates {
  latitude: number;
  longitude: number;
  altitude?: number;
}

export interface FileEntity {
  /** Absolute path to the physical file */
  path: string;
  /** Base filename with extension */
  name: string;
  /** Lowercase file extension including dot (e.g. '.jpg') */
  extension: string;
  /** File size in bytes */
  size: number;
  /** Detected or declared MIME type */
  mimeType?: string;
  /** Matched Google Takeout JSON sidecar path if found */
  jsonCompanionPath?: string;
  /** Creation/Modification time from filesystem */
  fileModifiedTime?: Date;
}

export class MediaEntity {
  /** Unique ID / content hash */
  id: string;
  /** Content hash (XXH3 or SHA-256) */
  contentHash: string;
  /** The primary physical file used as the source for copying/moving */
  primaryFile: FileEntity;
  /** All physical duplicates of this file found across Takeout folders */
  duplicateFiles: FileEntity[] = [];
  /** Best determined date taken */
  dateTaken: Date = new Date(0);
  /** Accuracy/source of the determined timestamp */
  dateAccuracy: DateAccuracy = DateAccuracy.NONE;
  /** GPS coordinates extracted from JSON or EXIF */
  coordinates?: GeoCoordinates;
  /** Title from Google JSON metadata */
  title?: string;
  /** Description/caption from Google JSON metadata */
  description?: string;
  /** Album names this media entity belongs to */
  albums: Set<string> = new Set();
  /** Year folder if found (e.g. "Photos from 2021") */
  yearFolder?: string;
  /** Special folder if found (e.g. "Archive", "Locked Folder", "Trash") */
  specialFolder?: string;
  /** True if this is an Apple Live Photo or Google Motion Photo */
  isLivePhoto: boolean = false;
  /** Paired video companion for Live Photo (e.g. .MOV or .MP4) */
  pairedVideoFile?: FileEntity;
  /** Destination path where primaryFile will be moved/copied */
  targetOutputPath?: string;

  constructor(primaryFile: FileEntity, contentHash: string = '') {
    this.primaryFile = primaryFile;
    this.contentHash = contentHash;
    this.id = contentHash || primaryFile.path;
  }

  addDuplicate(file: FileEntity): void {
    if (file.path !== this.primaryFile.path) {
      this.duplicateFiles.push(file);
    }
  }

  addAlbum(albumName: string): void {
    if (albumName && albumName.trim().length > 0) {
      this.albums.add(albumName.trim());
    }
  }
}

export interface AlbumEntity {
  /** Original album folder name */
  name: string;
  /** Sanitized and Unicode-normalized name safe for all filesystems */
  normalizedName: string;
  /** Set of media IDs / hashes belonging to this album */
  mediaIds: Set<string>;
}
