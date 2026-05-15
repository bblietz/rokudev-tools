// packages/brs-gen/src/build/screensaver-validators.ts
//
// Post-zip cert validator for screensaver channels.
//
// Cert rule 3.7: screensaver zip MUST be <= 4 MB.
// - Hard error if zip > 4 MB (throws with code SCREENSAVER_ZIP_TOO_LARGE).
// - Warning if zip > 3.5 MB but <= 4 MB.
//
// Template-conditional: only fires when the manifest contains screensaver_title=.
// Regular app zips are completely unaffected.

import { stat } from 'node:fs/promises';

export interface ValidationResult {
  warnings: string[];
}

const MAX_BYTES = 4 * 1024 * 1024;
const WARN_BYTES = 3.5 * 1024 * 1024;

export async function validateScreensaverZipSize(
  zipPath: string,
  manifestText: string,
): Promise<ValidationResult> {
  const isScreensaver = /^screensaver_title\s*=/m.test(manifestText);
  if (!isScreensaver) return { warnings: [] };

  const { size } = await stat(zipPath);
  if (size > MAX_BYTES) {
    const mb = (size / (1024 * 1024)).toFixed(2);
    const err = new Error(
      `SCREENSAVER_ZIP_TOO_LARGE: screensaver zip is ${mb} MB; cert rule 3.7 requires <= 4 MB`,
    );
    (err as Error & { code: string }).code = 'SCREENSAVER_ZIP_TOO_LARGE';
    throw err;
  }
  if (size > WARN_BYTES) {
    const mb = (size / (1024 * 1024)).toFixed(1);
    return { warnings: [`screensaver zip is ${mb} MB; approaching cert rule 3.7 limit (4 MB)`] };
  }
  return { warnings: [] };
}
