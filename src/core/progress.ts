import fs from 'node:fs/promises';
import path from 'node:path';
import { ProcessingContext } from './context.js';

export interface ProgressData {
  version: string;
  lastUpdated: string;
  completedSteps: number[];
  steps: Record<
    number,
    {
      name: string;
      completedAt: string;
      durationMs: number;
      data: Record<string, unknown>;
    }
  >;
}

export class ProgressManager {
  static readonly PROGRESS_FILENAME = 'progress.json';

  static getProgressFilePath(outputDir: string): string {
    return path.join(outputDir, this.PROGRESS_FILENAME);
  }

  static async loadProgress(outputDir: string): Promise<ProgressData | null> {
    try {
      const progressPath = this.getProgressFilePath(outputDir);
      const raw = await fs.readFile(progressPath, 'utf-8');
      return JSON.parse(raw) as ProgressData;
    } catch {
      return null;
    }
  }

  static isStepCompleted(progress: ProgressData | null, stepNumber: number): boolean {
    if (!progress) return false;
    return progress.completedSteps.includes(stepNumber);
  }

  static async saveStepProgress(
    context: ProcessingContext,
    stepNumber: number,
    stepName: string,
    durationMs: number,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    if (context.config.disableResume || context.config.dryRun) return;

    const outputDir = context.config.outputPath;
    await fs.mkdir(outputDir, { recursive: true });
    const progressPath = this.getProgressFilePath(outputDir);

    let progress = await this.loadProgress(outputDir);
    if (!progress) {
      progress = {
        version: '1.0.0',
        lastUpdated: new Date().toISOString(),
        completedSteps: [],
        steps: {},
      };
    }

    if (!progress.completedSteps.includes(stepNumber)) {
      progress.completedSteps.push(stepNumber);
      progress.completedSteps.sort((a, b) => a - b);
    }

    progress.lastUpdated = new Date().toISOString();
    progress.steps[stepNumber] = {
      name: stepName,
      completedAt: new Date().toISOString(),
      durationMs,
      data,
    };

    // Atomic write
    const tempPath = `${progressPath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(progress, null, 2), 'utf-8');
    await fs.rename(tempPath, progressPath);
  }

  static async clearProgress(outputDir: string): Promise<void> {
    try {
      const progressPath = this.getProgressFilePath(outputDir);
      await fs.unlink(progressPath);
    } catch {
      // Ignored if file doesn't exist
    }
  }
}
