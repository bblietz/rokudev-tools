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

import { Schema as ScreensaverSchema } from '../templates/screensaver/schema.js';

describe('SCREENSAVER_TITLE_CONTAINS_ROKU validator', () => {
  const baseSpec = {
    spec_version: 2 as const,
    template: 'screensaver' as const,
    modules: [],
    app: { name: 'PLACEHOLDER', major_version: 1, minor_version: 0, build_version: 0 },
  };

  it('rejects spec.app.name containing "Roku" (case-insensitive) and includes the offender in the message', () => {
    const r1 = ScreensaverSchema.safeParse({ ...baseSpec, app: { ...baseSpec.app, name: 'Roku Photos' } });
    expect(r1.success).toBe(false);
    if (!r1.success) {
      const json = JSON.stringify(r1.error.format());
      // Spec §4 contract: message contains the cert-rule preface AND the offending value.
      expect(json).toMatch(/screensaver_title cannot contain the word \\"Roku\\"/);
      expect(json).toMatch(/spec\.app\.name was \\"Roku Photos\\"/);
    }

    const r2 = ScreensaverSchema.safeParse({ ...baseSpec, app: { ...baseSpec.app, name: 'ROKU PHOTOS' } });
    expect(r2.success).toBe(false);
    if (!r2.success) {
      expect(JSON.stringify(r2.error.format())).toMatch(/spec\.app\.name was \\"ROKU PHOTOS\\"/);
    }

    const r3 = ScreensaverSchema.safeParse({ ...baseSpec, app: { ...baseSpec.app, name: 'My rOKu Channel' } });
    expect(r3.success).toBe(false);
  });

  it('accepts spec.app.name without "Roku"', () => {
    const r = ScreensaverSchema.safeParse({ ...baseSpec, app: { ...baseSpec.app, name: 'Family Photos' } });
    expect(r.success).toBe(true);
  });
});

describe('screensaver content schema', () => {
  const base = {
    spec_version: 2 as const,
    template: 'screensaver' as const,
    modules: [],
    app: { name: 'OK Name', major_version: 1, minor_version: 0, build_version: 0 },
  };

  it('applies defaults: motion=ken_burns, transition_seconds=7, feed_format=rokudev_screensaver_v1', () => {
    const r = ScreensaverSchema.parse({ ...base, content: {} });
    expect(r.content?.motion).toBe('ken_burns');
    expect(r.content?.transition_seconds).toBe(7);
    expect(r.content?.feed_format).toBe('rokudev_screensaver_v1');
  });

  it('rejects transition_seconds < 4', () => {
    const r = ScreensaverSchema.safeParse({ ...base, content: { transition_seconds: 3 } });
    expect(r.success).toBe(false);
  });

  it('rejects transition_seconds > 30', () => {
    const r = ScreensaverSchema.safeParse({ ...base, content: { transition_seconds: 31 } });
    expect(r.success).toBe(false);
  });

  it('rejects unknown content fields (strict)', () => {
    const r = ScreensaverSchema.safeParse({ ...base, content: { random_field: true } as object });
    expect(r.success).toBe(false);
  });

  it('rejects motion outside enum', () => {
    const r = ScreensaverSchema.safeParse({ ...base, content: { motion: 'sparkles' } as object });
    expect(r.success).toBe(false);
  });
});
