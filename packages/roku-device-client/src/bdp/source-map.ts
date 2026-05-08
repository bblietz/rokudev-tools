/**
 * SourceMapResolver: bidirectional .bs <-> .brs line translation.
 *
 * Wraps a SourceMapConsumer from the Mozilla source-map library. The instance
 * owns WASM-backed state and MUST be explicitly disposed by calling dispose()
 * when no longer needed.
 *
 * Usage:
 *   const r = await SourceMapResolver.fromMapFile('main.brs.map');
 *   try {
 *     const out = r.toCompiled('main.bs', 10);
 *   } finally {
 *     r.dispose();
 *   }
 */

import { SourceMapConsumer } from 'source-map';
import type { SourceMapConsumer as SourceMapConsumerType } from 'source-map';
import { readFile } from 'node:fs/promises';

/**
 * Bias constant: return null when no exact mapping exists rather than
 * snapping to the nearest lower-bound mapping. This gives the semantics
 * expected by a debugger (unmapped line -> null, not "nearest line").
 */
const EXACT_BIAS = SourceMapConsumer.LEAST_UPPER_BOUND;

export class SourceMapResolver {
  private disposed = false;

  private constructor(
    private readonly consumer: SourceMapConsumerType,
    /** The generated file name, derived from the source map's file field. */
    private readonly generatedFile: string,
  ) {}

  /**
   * Construct a SourceMapResolver by reading and parsing a .brs.map file from disk.
   *
   * @param mapPath - Absolute or relative path to the source map JSON file.
   * @throws If the file cannot be read or the JSON is not a valid source map.
   */
  static async fromMapFile(mapPath: string): Promise<SourceMapResolver> {
    const json = await readFile(mapPath, 'utf8');
    const consumer = await new SourceMapConsumer(json);
    // BasicSourceMapConsumer has a .file property; IndexedSourceMapConsumer does not.
    const generatedFile = (consumer as { file?: string }).file ?? '';
    return new SourceMapResolver(consumer, generatedFile);
  }

  /**
   * Translate a .bs (source) line to its corresponding .brs (compiled) line.
   *
   * @param sourceFile  - The original source filename (e.g. 'main.bs').
   * @param sourceLine  - The 1-based line number in the source file.
   * @returns { compiledFile, compiledLine } if a mapping exists, null otherwise.
   */
  toCompiled(
    sourceFile: string,
    sourceLine: number,
  ): { compiledFile: string; compiledLine: number } | null {
    const pos = this.consumer.generatedPositionFor({
      source: sourceFile,
      line: sourceLine,
      column: 0,
      bias: EXACT_BIAS,
    });
    if (pos.line == null) return null;
    return {
      compiledFile: this.generatedFile || sourceFile,
      compiledLine: pos.line,
    };
  }

  /**
   * Translate a .brs (compiled) line back to its corresponding .bs (source) line.
   *
   * @param _compiledFile - The generated filename (unused; present for symmetry).
   * @param compiledLine  - The 1-based line number in the compiled file.
   * @returns { sourceFile, sourceLine } if a mapping exists, null otherwise.
   */
  toSource(
    _compiledFile: string,
    compiledLine: number,
  ): { sourceFile: string; sourceLine: number } | null {
    const pos = this.consumer.originalPositionFor({ line: compiledLine, column: 0 });
    if (pos.source == null || pos.line == null) return null;
    return { sourceFile: pos.source, sourceLine: pos.line };
  }

  /**
   * Release WASM-backed resources held by the underlying SourceMapConsumer.
   * Idempotent: safe to call multiple times.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.consumer.destroy();
  }
}
