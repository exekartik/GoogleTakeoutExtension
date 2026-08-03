import { ProcessingConfig } from './config.js';
import { MediaEntity, FileEntity, AlbumEntity } from '../models/media-entity.js';

export class ProcessingContext {
  readonly config: ProcessingConfig;
  /** Discovered raw physical media files before deduplication */
  discoveredFiles: FileEntity[] = [];
  /** Map of unique content hash to canonical MediaEntity */
  mediaEntities: Map<string, MediaEntity> = new Map();
  /** Map of normalized album name to AlbumEntity */
  albums: Map<string, AlbumEntity> = new Map();
  /** Set of Takeout year folder names detected (e.g., "Photos from 2023") */
  yearFolders: Set<string> = new Set();
  /** Set of special folders detected (e.g., "Trash", "Archive", "Locked Folder") */
  specialFolders: Set<string> = new Set();
  /** Cache of step execution results */
  stepResults: Map<string, Record<string, unknown>> = new Map();

  constructor(config: ProcessingConfig) {
    this.config = config;
  }

  get totalMediaCount(): number {
    return this.mediaEntities.size;
  }

  get totalRawFilesCount(): number {
    return this.discoveredFiles.length;
  }

  get totalDuplicatesCount(): number {
    let count = 0;
    for (const entity of this.mediaEntities.values()) {
      count += entity.duplicateFiles.length;
    }
    return count;
  }

  setStepResult(stepName: string, data: Record<string, unknown>): void {
    this.stepResults.set(stepName, data);
  }

  getStepResult<T = unknown>(stepName: string): T | undefined {
    return this.stepResults.get(stepName) as T | undefined;
  }
}
