// packages/brs-gen/tests/cert-validators.test.ts
//
// Unit tests for the post-zip cert validator (cert rule 3.7: screensaver zips
// must be <= 4 MB). The validator is template-conditional: it only fires when
// the manifest contains screensaver_title=. Regular app zips are unaffected.

import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yazl from 'yazl';
import { createWriteStream } from 'node:fs';

// Helper: build a synthetic zip of approximately sizeBytes by stuffing a
// single large padding file. compress: false keeps the encoded size close to
// the requested size (no deflate shrinkage). Actual zip will be sizeBytes
// minus 256 bytes of padding (zip local-file headers add ~30 bytes each) but
// that's close enough for the threshold tests below.
async function buildSyntheticZip(
  zipPath: string,
  sizeBytes: number,
  manifestContent: string,
): Promise<void> {
  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from(manifestContent, 'utf8'), 'manifest', {
    mtime: new Date(0),
    compress: false,
  });
  // Stuff a dummy file so the resulting zip is approximately sizeBytes large.
  const padding = Buffer.alloc(Math.max(0, sizeBytes - 256));
  zip.addBuffer(padding, 'padding.bin', { mtime: new Date(0), compress: false });
  zip.end();
  await new Promise<void>((resolve, reject) => {
    zip.outputStream.pipe(createWriteStream(zipPath)).on('close', resolve).on('error', reject);
  });
}

describe('SCREENSAVER_ZIP_TOO_LARGE validator', () => {
  it('throws on > 4 MB zip when manifest has screensaver_title', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'brs-gen-cv-'));
    try {
      const zipPath = join(dir, 'big.zip');
      await buildSyntheticZip(
        zipPath,
        4.5 * 1024 * 1024,
        'title=Foo\nscreensaver_title=Foo\n',
      );
      const { validateScreensaverZipSize } = await import(
        '../src/build/screensaver-validators.js'
      );
      const manifestText = 'title=Foo\nscreensaver_title=Foo\n';
      await expect(validateScreensaverZipSize(zipPath, manifestText)).rejects.toThrow(
        /SCREENSAVER_ZIP_TOO_LARGE/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns warning on > 3.5 MB but <= 4 MB zip when manifest has screensaver_title', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'brs-gen-cv-'));
    try {
      const zipPath = join(dir, 'med.zip');
      await buildSyntheticZip(
        zipPath,
        3.7 * 1024 * 1024,
        'title=Foo\nscreensaver_title=Foo\n',
      );
      const { validateScreensaverZipSize } = await import(
        '../src/build/screensaver-validators.js'
      );
      const result = await validateScreensaverZipSize(
        zipPath,
        'title=Foo\nscreensaver_title=Foo\n',
      );
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringMatching(/3\.\d MB/)]),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('passes for any size zip when manifest LACKS screensaver_title (apps unaffected)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'brs-gen-cv-'));
    try {
      const zipPath = join(dir, 'app.zip');
      await buildSyntheticZip(
        zipPath,
        4.5 * 1024 * 1024,
        'title=AppFoo\nsplash_color=#000000\n',
      );
      const { validateScreensaverZipSize } = await import(
        '../src/build/screensaver-validators.js'
      );
      const result = await validateScreensaverZipSize(
        zipPath,
        'title=AppFoo\nsplash_color=#000000\n',
      );
      expect(result.warnings).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
