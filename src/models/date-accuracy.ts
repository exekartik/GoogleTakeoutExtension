/**
 * Confidence level of extracted timestamps.
 * Higher numeric values indicate higher confidence/accuracy.
 */
export enum DateAccuracy {
  NONE = 0,
  FOLDER_YEAR = 1,
  FILENAME = 2,
  EXIF = 3,
  JSON = 4,
}

export function getDateAccuracyLabel(accuracy: DateAccuracy): string {
  switch (accuracy) {
    case DateAccuracy.JSON:
      return 'Google JSON metadata';
    case DateAccuracy.EXIF:
      return 'EXIF / Media header';
    case DateAccuracy.FILENAME:
      return 'Filename timestamp';
    case DateAccuracy.FOLDER_YEAR:
      return 'Takeout year folder';
    case DateAccuracy.NONE:
    default:
      return 'Unknown / Fallback';
  }
}
