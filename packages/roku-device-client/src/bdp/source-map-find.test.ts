import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findSourceMap } from './source-map-find.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'findmap-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function writeMinimalSourceMap(
  path: string,
  source: string,
  sourceLine: number,
  generatedLine: number,
): Promise<void> {
  const { SourceMapGenerator } = await import('source-map');
  const gen = new SourceMapGenerator({ file: source.replace(/\.bs$/, '.brs') });
  gen.addMapping({
    source,
    original: { line: sourceLine, column: 0 },
    generated: { line: generatedLine, column: 0 },
  });
  await writeFile(path, gen.toString(), 'utf8');
}

async function setupProject(opts: {
  bsconfig?: object | null;
  stagingPath?: string; // where to write the .brs.map
  rootDir?: string;
  bsRelPath?: string;
}): Promise<{ bsFile: string; mapFile: string | null }> {
  const projDir = join(tmpDir, 'proj');
  await mkdir(projDir, { recursive: true });

  // Create source layout
  const rootDir = opts.rootDir ?? 'src';
  const bsRelPath = opts.bsRelPath ?? 'main.bs';
  const bsFile = join(projDir, rootDir, bsRelPath);
  await mkdir(join(projDir, rootDir), { recursive: true });
  await writeFile(bsFile, "' Sample BrighterScript\n", 'utf8');

  // bsconfig.json
  if (opts.bsconfig !== null) {
    await writeFile(
      join(projDir, 'bsconfig.json'),
      JSON.stringify(opts.bsconfig ?? { rootDir, stagingFolderPath: 'out/.roku-deploy-staging' }),
      'utf8',
    );
  }

  // Write the .brs.map at the requested location
  let mapFile: string | null = null;
  if (opts.stagingPath !== undefined) {
    const mapRelPath = bsRelPath.replace(/\.bs$/, '.brs.map');
    const mapDir = join(
      projDir,
      opts.stagingPath,
      ...(mapRelPath.includes('/') ? mapRelPath.split('/').slice(0, -1) : []),
    );
    await mkdir(mapDir, { recursive: true });
    mapFile = join(projDir, opts.stagingPath, mapRelPath);
    await writeMinimalSourceMap(mapFile, bsRelPath, 10, 15);
  }

  return { bsFile, mapFile };
}

describe('findSourceMap', () => {
  it('finds map at configured stagingFolderPath', async () => {
    const { bsFile, mapFile } = await setupProject({
      bsconfig: { rootDir: 'src', stagingFolderPath: 'build/staging' },
      rootDir: 'src',
      stagingPath: 'build/staging',
    });
    const result = await findSourceMap(bsFile);
    expect(result).toBe(mapFile);
  });

  it('falls back to out/.roku-deploy-staging if stagingFolderPath not configured', async () => {
    const { bsFile, mapFile } = await setupProject({
      bsconfig: { rootDir: 'src' }, // no stagingFolderPath
      rootDir: 'src',
      stagingPath: 'out/.roku-deploy-staging',
    });
    const result = await findSourceMap(bsFile);
    expect(result).toBe(mapFile);
  });

  it('falls back to legacy .roku-deploy-staging', async () => {
    const { bsFile, mapFile } = await setupProject({
      bsconfig: { rootDir: 'src' },
      rootDir: 'src',
      stagingPath: '.roku-deploy-staging',
    });
    const result = await findSourceMap(bsFile);
    expect(result).toBe(mapFile);
  });

  it('returns null when no bsconfig.json', async () => {
    const { bsFile } = await setupProject({ bsconfig: null });
    const result = await findSourceMap(bsFile);
    expect(result).toBeNull();
  });

  it('returns null when staging path has no map', async () => {
    const { bsFile } = await setupProject({
      bsconfig: { rootDir: 'src', stagingFolderPath: 'build/staging' },
      rootDir: 'src',
      // stagingPath omitted = no map written
    });
    const result = await findSourceMap(bsFile);
    expect(result).toBeNull();
  });

  it('respects projectRoot ceiling', async () => {
    const { bsFile, mapFile } = await setupProject({
      bsconfig: { rootDir: 'src' },
      rootDir: 'src',
      stagingPath: 'out/.roku-deploy-staging',
    });
    const projDir = join(tmpDir, 'proj');
    const result = await findSourceMap(bsFile, projDir);
    expect(result).toBe(mapFile);
  });

  it('configured stagingFolderPath wins over fallbacks (preventing stale-map surface)', async () => {
    // Put a map in BOTH the configured staging AND the legacy fallback.
    // Verify the configured one is returned.
    const { bsFile, mapFile } = await setupProject({
      bsconfig: { rootDir: 'src', stagingFolderPath: 'build/staging' },
      rootDir: 'src',
      stagingPath: 'build/staging',
    });
    // Also create a stale map in the legacy location
    const legacyMapDir = join(tmpDir, 'proj', '.roku-deploy-staging');
    await mkdir(legacyMapDir, { recursive: true });
    const legacyMapPath = join(legacyMapDir, 'main.brs.map');
    await writeMinimalSourceMap(legacyMapPath, 'main.bs', 99, 99);

    const result = await findSourceMap(bsFile);
    expect(result).toBe(mapFile); // configured wins
    expect(result).not.toBe(legacyMapPath);
  });
});
