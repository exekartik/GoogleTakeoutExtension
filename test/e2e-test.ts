import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProcessingPipeline } from '../src/core/pipeline.js';
import {
  AlbumBehavior,
  DateDivision,
  DEFAULT_CONFIG,
  ExtensionFixingMode,
} from '../src/core/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTest(): Promise<void> {
  const testInputDir = path.join(__dirname, 'mock_takeout_input');
  const testOutputDir = path.join(__dirname, 'mock_takeout_output');

  // Clean previous test dirs
  await fs.rm(testInputDir, { recursive: true, force: true });
  await fs.rm(testOutputDir, { recursive: true, force: true });

  // 1. Create Mock Input Structure
  const year2023Dir = path.join(testInputDir, 'Photos from 2023');
  const albumDir = path.join(testInputDir, 'Summer Trip');
  const year2022Dir = path.join(testInputDir, 'Photos from 2022');

  await fs.mkdir(year2023Dir, { recursive: true });
  await fs.mkdir(albumDir, { recursive: true });
  await fs.mkdir(year2022Dir, { recursive: true });

  // Create sample media content
  const samplePhotoContent = Buffer.from('FAKE_JPEG_IMAGE_CONTENT_SAMPLE_1');
  const samplePhoto2Content = Buffer.from('FAKE_JPEG_IMAGE_CONTENT_SAMPLE_2');

  // Photo 1 in Year folder
  await fs.writeFile(path.join(year2023Dir, 'photo1.jpg'), samplePhotoContent);
  await fs.writeFile(
    path.join(year2023Dir, 'photo1.jpg.json'),
    JSON.stringify({
      title: 'Beach Day',
      description: 'Sunny beach in California',
      photoTakenTime: { timestamp: '1684944000', formatted: 'May 24, 2023, 4:00:00 PM UTC' },
      geoData: { latitude: 36.7783, longitude: -119.4179, altitude: 0.0 },
    }),
  );

  // Photo 1 duplicated in Album folder
  await fs.writeFile(path.join(albumDir, 'photo1.jpg'), samplePhotoContent);

  // Photo 2 (Filename date test)
  await fs.writeFile(path.join(year2022Dir, 'IMG_20220815_143000.jpg'), samplePhoto2Content);

  console.log('✅ Mock Google Takeout data created.');

  // 2. Run Pipeline
  const pipeline = new ProcessingPipeline();
  const result = await pipeline.execute({
    ...DEFAULT_CONFIG,
    inputPath: testInputDir,
    outputPath: testOutputDir,
    albumBehavior: AlbumBehavior.SHORTCUT,
    dateDivision: DateDivision.YEAR_MONTH,
    extensionFixing: ExtensionFixingMode.NONE, // skip mime inspect on fake buffer
    writeExif: false, // skip exiftool on fake buffer
  });

  console.log('\n--- Verification Assertions ---');
  console.log(`Pipeline Success: ${result.isSuccess ? 'PASS' : 'FAIL'}`);
  console.log(`Unique Media Count: ${result.totalMediaCount} (Expected: 2)`);
  console.log(`Duplicates Merged: ${result.totalDuplicatesMerged} (Expected: 1)`);

  if (result.totalMediaCount !== 2 || result.totalDuplicatesMerged !== 1) {
    throw new Error('Test Assertions Failed!');
  }

  // Check output folder structure
  const allPhotos2023 = path.join(testOutputDir, 'ALL_PHOTOS', '2023', '05');
  const files2023 = await fs.readdir(allPhotos2023);
  console.log(`Files in ALL_PHOTOS/2023/05: ${files2023.join(', ')}`);

  const albumsSummerTrip = path.join(testOutputDir, 'Albums', 'Summer Trip');
  const albumFiles = await fs.readdir(albumsSummerTrip);
  console.log(`Files in Albums/Summer Trip: ${albumFiles.join(', ')}`);

  // Cleanup test artifacts
  await fs.rm(testInputDir, { recursive: true, force: true });
  await fs.rm(testOutputDir, { recursive: true, force: true });

  console.log('\n🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY!\n');
}

runTest().catch((err) => {
  console.error('❌ Test Failed:', err);
  process.exit(1);
});
