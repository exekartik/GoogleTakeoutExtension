import { ProcessingContext } from '../core/context.js';
import { ProgressManager } from '../core/progress.js';

export interface StepResult {
  stepNumber: number;
  stepName: string;
  isSuccess: boolean;
  durationMs: number;
  message?: string;
  data: Record<string, unknown>;
  error?: Error;
}

export abstract class ProcessingStep {
  abstract readonly stepNumber: number;
  abstract readonly name: string;

  /**
   * Evaluates if this step should be skipped based on config or context.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  shouldSkip(_context: ProcessingContext): boolean {
    return false;
  }

  /**
   * Executes the core logic of the step.
   */
  abstract run(
    context: ProcessingContext,
  ): Promise<Omit<StepResult, 'stepNumber' | 'stepName' | 'durationMs'>>;

  /**
   * Pipeline wrapper that measures timings, catches errors, and logs progress.
   */
  async execute(context: ProcessingContext): Promise<StepResult> {
    const startTime = Date.now();

    // Check if resume allows skipping
    if (!context.config.disableResume) {
      const progress = await ProgressManager.loadProgress(context.config.outputPath);
      if (ProgressManager.isStepCompleted(progress, this.stepNumber)) {
        const stepData = progress?.steps[this.stepNumber];
        return {
          stepNumber: this.stepNumber,
          stepName: this.name,
          isSuccess: true,
          durationMs: stepData?.durationMs ?? 0,
          message: `Resumed: step already completed in previous run`,
          data: stepData?.data ?? {},
        };
      }
    }

    if (this.shouldSkip(context)) {
      return {
        stepNumber: this.stepNumber,
        stepName: this.name,
        isSuccess: true,
        durationMs: 0,
        message: 'Skipped based on configuration',
        data: { skipped: true },
      };
    }

    try {
      const result = await this.run(context);
      const durationMs = Date.now() - startTime;

      const fullResult: StepResult = {
        stepNumber: this.stepNumber,
        stepName: this.name,
        durationMs,
        ...result,
      };

      if (fullResult.isSuccess) {
        await ProgressManager.saveStepProgress(
          context,
          this.stepNumber,
          this.name,
          durationMs,
          fullResult.data,
        );
      }

      return fullResult;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const error = err instanceof Error ? err : new Error(String(err));
      return {
        stepNumber: this.stepNumber,
        stepName: this.name,
        isSuccess: false,
        durationMs,
        message: `Failed: ${error.message}`,
        error,
        data: {},
      };
    }
  }
}
