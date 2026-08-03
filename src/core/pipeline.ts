import chalk from 'chalk';
import { ProcessingConfig } from './config.js';
import { ProcessingContext } from './context.js';
import { ProcessingStep, StepResult } from '../steps/base-step.js';
import { FixExtensionsStep } from '../steps/step-01-fix-extensions.js';
import { DiscoverMediaStep } from '../steps/step-02-discover-media.js';
import { DeduplicateStep } from '../steps/step-03-deduplicate.js';
import { ExtractDatesStep } from '../steps/step-04-extract-dates.js';
import { FindAlbumsStep } from '../steps/step-05-find-albums.js';
import { MoveFilesStep } from '../steps/step-06-move-files.js';
import { WriteExifStep } from '../steps/step-07-write-exif.js';
import { UpdateCreationTimeStep } from '../steps/step-08-update-creation-time.js';
import { ExifService } from '../services/exif.service.js';

/**
 * Summary of a complete pipeline run, returned by ProcessingPipeline.execute().
 */
export interface PipelineSummary {
  isSuccess: boolean;
  totalDurationMs: number;
  stepResults: StepResult[];
  totalMediaCount: number;
  totalDuplicatesMerged: number;
}

/**
 * ============================================================================
 * PROCESSING PIPELINE (ORCHESTRATOR)
 * ============================================================================
 *
 * WHY THIS CLASS EXISTS:
 * Processing Google Takeout exports is a complex multi-stage process. State
 * from one step (like deduplication) must flow perfectly into the next step
 * (like date extraction). This orchestrator enforces strict sequential execution.
 *
 * WHAT THIS DOES:
 * 1. Instantiates all 8 processing steps in their required logical order.
 * 2. Creates the global ProcessingContext which holds memory and configuration.
 * 3. Iterates through the steps sequentially, passing the context along.
 * 4. Captures durations, successes, and failure states for each step.
 * 5. Safely cleans up background daemon services (like ExifTool) in a `finally` block.
 * 6. Prints a user-friendly console report of progress.
 */
export class ProcessingPipeline {
  /** Array of sequentially ordered processing stages */
  private readonly steps: ProcessingStep[] = [
    new FixExtensionsStep(),
    new DiscoverMediaStep(),
    new DeduplicateStep(),
    new ExtractDatesStep(),
    new FindAlbumsStep(),
    new MoveFilesStep(),
    new WriteExifStep(),
    new UpdateCreationTimeStep(),
  ];

  /**
   * Executes the entire processing pipeline from start to finish.
   * @param config The user configuration choices mapped from the CLI or wizard.
   */
  async execute(config: ProcessingConfig): Promise<PipelineSummary> {
    const startTime = Date.now();
    const context = new ProcessingContext(config);
    const stepResults: StepResult[] = [];

    console.log(chalk.bold.cyan('\n🚀 Google Takeout Extension — Processing Pipeline'));
    console.log(chalk.gray(`Input:  ${config.inputPath}`));
    console.log(chalk.gray(`Output: ${config.outputPath}`));
    console.log(
      chalk.gray(
        `Mode:   Album=${config.albumBehavior}, DateDivision=${config.dateDivision}, WriteEXIF=${config.writeExif}\n`,
      ),
    );

    let pipelineFailed = false;

    try {
      // Execute each step in sequence
      for (const step of this.steps) {
        console.log(chalk.bold(`▶️  [Step ${step.stepNumber}/8] ${chalk.yellow(step.name)}...`));

        // Await the step's asynchronous run logic
        const result = await step.execute(context);
        stepResults.push(result);

        const durationFormatted = `${(result.durationMs / 1000).toFixed(2)}s`;

        if (result.isSuccess) {
          console.log(
            `   ${chalk.green('✔')} Completed in ${chalk.gray(durationFormatted)}: ${result.message || 'Done'}\n`,
          );
        } else {
          console.log(
            `   ${chalk.red('✖')} Failed in ${chalk.gray(durationFormatted)}: ${result.message}\n`,
          );
          // Steps 2 (Discovery) and 6 (Move Files) are critical. If they fail, abort immediately.
          if (step.stepNumber === 2 || step.stepNumber === 6) {
            console.log(chalk.red.bold('⚠️  Critical step failed. Stopping pipeline.'));
            pipelineFailed = true;
            break;
          }
        }
      }
    } finally {
      // CRITICAL: Always clean up background daemon processes (ExifTool)
      // even if a step throws an uncaught exception, to prevent memory leaks or zombie processes.
      await ExifService.close();
    }

    const totalDurationMs = Date.now() - startTime;
    const isSuccess = !pipelineFailed && stepResults.every((r) => r.isSuccess);

    this.printSummary(context, isSuccess, totalDurationMs, stepResults);

    return {
      isSuccess,
      totalDurationMs,
      stepResults,
      totalMediaCount: context.totalMediaCount,
      totalDuplicatesMerged: context.totalDuplicatesCount,
    };
  }

  /**
   * Prints the final statistics output box to the console.
   */
  private printSummary(
    context: ProcessingContext,
    isSuccess: boolean,
    totalDurationMs: number,
    _stepResults: StepResult[],
  ): void {
    const totalTimeSec = (totalDurationMs / 1000).toFixed(2);

    console.log(chalk.bold.cyan('===================================================='));
    if (isSuccess) {
      console.log(chalk.bold.green(`🎉 Processing Finished Successfully in ${totalTimeSec}s!`));
    } else {
      console.log(chalk.bold.red(`❌ Processing Completed with Errors in ${totalTimeSec}s.`));
    }
    console.log(chalk.bold.cyan('===================================================='));

    console.log(`• Total unique media items: ${chalk.bold.white(context.totalMediaCount)}`);
    console.log(`• Duplicates merged:        ${chalk.bold.white(context.totalDuplicatesCount)}`);
    console.log(`• Albums recognized:        ${chalk.bold.white(context.albums.size)}`);
    console.log(`• Output directory:         ${chalk.underline(context.config.outputPath)}\n`);
  }
}
