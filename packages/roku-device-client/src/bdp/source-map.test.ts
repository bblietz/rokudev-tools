import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SourceMapResolver } from './source-map.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'srcmap-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

/**
 * Write a minimal source-map v3 JSON to the tmp dir.
 * Uses SourceMapGenerator to produce correctly-encoded VLQ mappings.
 */
async function writeMinimalSourceMap(
  name: string,
  mappings: Array<{ source: string; sourceLine: number; generatedLine: number }>,
): Promise<string> {
  const { SourceMapGenerator } = await import('source-map');
  const gen = new SourceMapGenerator({ file: `${name}.brs` });
  for (const m of mappings) {
    gen.addMapping({
      source: m.source,
      original: { line: m.sourceLine, column: 0 },
      generated: { line: m.generatedLine, column: 0 },
    });
  }
  const path = join(tmpDir, `${name}.brs.map`);
  await writeFile(path, gen.toString(), 'utf8');
  return path;
}

describe('SourceMapResolver', () => {
  it('forward translates .bs line to .brs line', async () => {
    const mapPath = await writeMinimalSourceMap('main', [
      { source: 'main.bs', sourceLine: 10, generatedLine: 15 },
    ]);
    const r = await SourceMapResolver.fromMapFile(mapPath);
    try {
      const out = r.toCompiled('main.bs', 10);
      expect(out).not.toBeNull();
      expect(out!.compiledLine).toBe(15);
    } finally {
      r.dispose();
    }
  });

  it('reverse translates .brs line back to .bs line', async () => {
    const mapPath = await writeMinimalSourceMap('main', [
      { source: 'main.bs', sourceLine: 10, generatedLine: 15 },
    ]);
    const r = await SourceMapResolver.fromMapFile(mapPath);
    try {
      const out = r.toSource('main.brs', 15);
      expect(out).not.toBeNull();
      expect(out!.sourceFile).toBe('main.bs');
      expect(out!.sourceLine).toBe(10);
    } finally {
      r.dispose();
    }
  });

  it('returns null for unmapped source line', async () => {
    const mapPath = await writeMinimalSourceMap('main', [
      { source: 'main.bs', sourceLine: 10, generatedLine: 15 },
    ]);
    const r = await SourceMapResolver.fromMapFile(mapPath);
    try {
      const out = r.toCompiled('main.bs', 999); // not mapped
      expect(out).toBeNull();
    } finally {
      r.dispose();
    }
  });

  it('returns null for unmapped compiled line', async () => {
    const mapPath = await writeMinimalSourceMap('main', [
      { source: 'main.bs', sourceLine: 10, generatedLine: 15 },
    ]);
    const r = await SourceMapResolver.fromMapFile(mapPath);
    try {
      const out = r.toSource('main.brs', 999); // not mapped
      expect(out).toBeNull();
    } finally {
      r.dispose();
    }
  });

  it('dispose() is idempotent', async () => {
    const mapPath = await writeMinimalSourceMap('main', [
      { source: 'main.bs', sourceLine: 10, generatedLine: 15 },
    ]);
    const r = await SourceMapResolver.fromMapFile(mapPath);
    expect(() => {
      r.dispose();
      r.dispose();
    }).not.toThrow();
  });

  it('toCompiled returns the generated file name from the source map', async () => {
    const mapPath = await writeMinimalSourceMap('utils', [
      { source: 'utils.bs', sourceLine: 5, generatedLine: 8 },
    ]);
    const r = await SourceMapResolver.fromMapFile(mapPath);
    try {
      const out = r.toCompiled('utils.bs', 5);
      expect(out).not.toBeNull();
      expect(out!.compiledFile).toBe('utils.brs');
      expect(out!.compiledLine).toBe(8);
    } finally {
      r.dispose();
    }
  });

  it('handles multiple mappings in the same file', async () => {
    const mapPath = await writeMinimalSourceMap('main', [
      { source: 'main.bs', sourceLine: 1, generatedLine: 1 },
      { source: 'main.bs', sourceLine: 5, generatedLine: 10 },
      { source: 'main.bs', sourceLine: 20, generatedLine: 35 },
    ]);
    const r = await SourceMapResolver.fromMapFile(mapPath);
    try {
      expect(r.toCompiled('main.bs', 1)?.compiledLine).toBe(1);
      expect(r.toCompiled('main.bs', 5)?.compiledLine).toBe(10);
      expect(r.toCompiled('main.bs', 20)?.compiledLine).toBe(35);

      expect(r.toSource('main.brs', 1)?.sourceLine).toBe(1);
      expect(r.toSource('main.brs', 10)?.sourceLine).toBe(5);
      expect(r.toSource('main.brs', 35)?.sourceLine).toBe(20);
    } finally {
      r.dispose();
    }
  });
});
