#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { input, select, confirm } from '@inquirer/prompts';
import {
  ProcessingConfig,
  DEFAULT_CONFIG,
  AlbumBehavior,
  DateDivision,
  ExtensionFixingMode,
  cleanPath,
  validateConfig,
} from '../core/config.js';
import { ProcessingPipeline } from '../core/pipeline.js';

const program = new Command();

program
  .name('gpth')
  .description(
    'Google Photos Takeout Helper in TypeScript — Organize, deduplicate, and date-tag Takeout exports',
  )
  .version('1.0.0')
  .option('-i, --input <path>', 'Path to Google Takeout input folder')
  .option('-o, --output <path>', 'Path to output organized library folder')
  .option(
    '-a, --album-behavior <mode>',
    'Album organization strategy (shortcut, duplicate-copy, json, reverse-shortcut, album-only, raw)',
    'shortcut',
  )
  .option(
    '-d, --date-division <level>',
    'Date folder organization (none, year, year-month, day)',
    'none',
  )
  .option('--no-exif', 'Disable writing recovered dates and GPS to EXIF headers')
  .option('--no-fix-extensions', 'Disable magic byte extension fixing')
  .option('--hardlink', 'Use hard links instead of symlinks for shortcuts (Windows only)')
  .option('--all-photos-dir <name>', 'Custom name for non-album photos directory', 'ALL_PHOTOS')
  .option('--no-resume', 'Force fresh run without reading previous progress.json')
  .option('--dry-run', 'Simulate processing without moving or modifying files')
  .option('-v, --verbose', 'Enable verbose diagnostic logging');

program.parse(process.argv);
const options = program.opts();

/**
 * Launches the interactive command-line wizard using `@inquirer/prompts`.
 * This guides the user step-by-step to configure their Google Takeout run
 * if they did not provide CLI arguments.
 */
async function runInteractiveWizard(): Promise<ProcessingConfig> {
  console.log(chalk.bold.cyan('\n📸 Google Photos Takeout Helper (TypeScript Edition)'));
  console.log(chalk.gray('Transform your Takeout export into an organized photo library.\n'));

  // Prompt: Google Takeout Input Folder
  const rawInput = await input({
    message: 'Enter path to your unzipped Google Takeout folder:',
    validate: (val) => (cleanPath(val).length > 0 ? true : 'Please enter a valid path'),
  });
  const inputPath = cleanPath(rawInput); // Automatically strip quotes added by drag-and-drop

  // Prompt: Output Library Folder
  const rawOutput = await input({
    message: 'Enter path to destination output folder:',
    validate: (val) => (cleanPath(val).length > 0 ? true : 'Please enter a valid path'),
  });
  const outputPath = cleanPath(rawOutput);

  // Prompt: Album Strategy
  const albumBehavior = await select<AlbumBehavior>({
    message: 'Select album organization strategy:',
    choices: [
      {
        name: '🔗 Shortcut (Recommended) - Real files in ALL_PHOTOS, symlinks in Album folders',
        value: AlbumBehavior.SHORTCUT,
      },
      {
        name: '📁 Duplicate Copy - Physical duplicate files in Album folders (takes more space)',
        value: AlbumBehavior.DUPLICATE_COPY,
      },
      {
        name: '📄 JSON Index - Creates albums.json playlist without duplicating files',
        value: AlbumBehavior.JSON,
      },
      {
        name: '🔄 Reverse Shortcut - Real files in Albums, shortcuts in ALL_PHOTOS',
        value: AlbumBehavior.REVERSE_SHORTCUT,
      },
      {
        name: '🗂️  Raw - Flat chronological library without album folders',
        value: AlbumBehavior.RAW,
      },
    ],
  });

  // Prompt: Date Hierarchy
  const dateDivision = await select<DateDivision>({
    message: 'Select date division folder hierarchy:',
    choices: [
      { name: 'None - Keep all photos in one main folder', value: DateDivision.NONE },
      { name: 'Year - Group into YYYY/ folders (e.g. 2023/)', value: DateDivision.YEAR },
      {
        name: 'Year / Month - Group into YYYY/MM/ folders (e.g. 2023/05/)',
        value: DateDivision.YEAR_MONTH,
      },
      { name: 'Year / Month / Day - Group into YYYY/MM/DD/ folders', value: DateDivision.DAY },
    ],
  });

  // Prompt: Write EXIF
  const writeExif = await confirm({
    message: 'Embed recovered timestamps and GPS coordinates into file EXIF headers?',
    default: true,
  });

  return {
    ...DEFAULT_CONFIG,
    inputPath,
    outputPath,
    albumBehavior,
    dateDivision,
    writeExif,
  };
}

/**
 * Main Entry Point for the CLI Application.
 * 1. Parses CLI flags.
 * 2. If flags are missing, launches the interactive wizard.
 * 3. Validates the final configuration.
 * 4. Initializes and executes the 8-step processing pipeline.
 */
async function main(): Promise<void> {
  try {
    let config: ProcessingConfig;

    if (!options.input || !options.output) {
      // If no input/output provided, run wizard (if running in an interactive terminal)
      if (process.stdin.isTTY) {
        config = await runInteractiveWizard();
      } else {
        // If not in interactive terminal, just print help and exit
        program.help();
        return;
      }
    } else {
      // If flags were provided, map commander options to ProcessingConfig
      config = {
        inputPath: options.input,
        outputPath: options.output,
        albumBehavior: (options.albumBehavior as AlbumBehavior) || AlbumBehavior.SHORTCUT,
        dateDivision: (options.dateDivision as DateDivision) || DateDivision.NONE,
        writeExif: options.exif !== false,
        extensionFixing:
          options.fixExtensions === false ? ExtensionFixingMode.NONE : ExtensionFixingMode.STANDARD,
        updateCreationTime: process.platform === 'win32', // Only relevant on Windows
        hardlink: !!options.hardlink,
        allPhotosDirName: options.allPhotosDir || 'ALL_PHOTOS',
        keepDuplicates: false,
        disableResume: options.resume === false,
        verbose: !!options.verbose,
        dryRun: !!options.dryRun,
      };
    }

    // Ensure input and output paths are valid and distinct
    validateConfig(config);

    // Initialize the sequential 8-step orchestrator
    const pipeline = new ProcessingPipeline();
    const result = await pipeline.execute(config);

    // Exit with code 0 on success, 1 on failure
    process.exit(result.isSuccess ? 0 : 1);
  } catch (error) {
    console.error(
      chalk.red.bold(`\n❌ Error: ${error instanceof Error ? error.message : String(error)}`),
    );
    process.exit(1);
  }
}

// Start the app
main();
