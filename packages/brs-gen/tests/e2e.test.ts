// packages/brs-gen/tests/e2e.test.ts
//
// End-to-end MCP smoke test for brs-gen.
//
// Spawns the real `dist/index.js` stdio server as a child process, walks it
// through the standard initialize -> tools/list -> tools/call flow, and
// asserts:
//
//   1. The tool catalog is exactly the 10 Plan-3 tools (sorted).
//   2. generate_app on the canonical stub spec produces a byte-equal zip
//      against tests/__golden__/stub.zip.
//   3. validate_manifest on the generated project returns ok: true.
//   4. lint returns ok: true with zero error diagnostics.
//   5. The generated .rokudev-tools/provenance.json byte-equals
//      tests/__golden__/stub.provenance.json.
//   6. generate_app on the video_grid_channel spec produces a byte-equal zip
//      against tests/__golden__/video-grid.zip.
//   7. validate_manifest on the video_grid_channel project returns ok: true.
//   8. lint on the video_grid_channel project returns ok: true with zero errors.
//
// TZ=UTC is forced for this test AND the spawned child because yazl 2.5.x
// encodes DOS mtime via local-time Date methods. Without a pinned TZ, the
// byte-equality assertions (2 and 5 above) fail on non-UTC hosts even though
// all other inputs are identical. See packages/brs-gen/src/build/zip.ts
// for the long-form explanation.
//
// Stdio plumbing ported from packages/rokudev-device/tests/e2e.test.ts.
//
// Prereq: `pnpm -C packages/brs-gen build` must have populated dist/index.js.

process.env.TZ = 'UTC';

import { afterEach, afterAll, beforeEach, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = dirname(__dirname); // tests/ -> packages/brs-gen/
const DIST_ENTRY = join(PKG_ROOT, 'dist', 'index.js');
const GOLDEN_DIR = join(__dirname, '__golden__');

const CANONICAL_SPEC = {
  spec_version: 2,
  template: 'stub_hello',
  modules: [{ id: 'stub_label', version_range: '^0.1.0', config: { text: 'hello world' } }],
  app: { name: 'Stub Channel', major_version: 1, minor_version: 0, build_version: 0 },
};

const EXPECTED_TOOL_NAMES = [
  'generate_app',
  'get_module_schema',
  'get_template_schema',
  'lint',
  'list_modules',
  'list_templates',
  'package_app',
  'spec_upgrade',
  'validate_assets',
  'validate_manifest',
].sort();

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

/**
 * Lightweight JSON-RPC-over-stdio client for the spawned MCP server.
 *
 * Frames are newline-delimited JSON on stdin/stdout. We buffer partial
 * stdout, split on '\n', and match responses by request id. initialize
 * must be called first; the server will not respond to tools/* until it
 * has received it.
 */
class McpChild {
  private proc: ChildProcessWithoutNullStreams;
  private buf = '';
  private pending = new Map<number, (res: JsonRpcResponse) => void>();
  private nextId = 1;
  private closeRejecter?: (err: Error) => void;

  constructor() {
    this.proc = spawn(process.execPath, [DIST_ENTRY], {
      cwd: PKG_ROOT,
      // TZ=UTC is propagated from the parent env (we set it at the top of
      // this file BEFORE import-time capture), so the child inherits it.
      env: { ...process.env, TZ: 'UTC' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc.stdout.on('data', (chunk: Buffer) => this.onStdout(chunk));
    this.proc.stderr.on('data', (chunk: Buffer) => {
      // Swallow stderr; the server only uses it for startup/log noise.
      // Uncomment to debug: process.stderr.write(chunk);
      void chunk;
    });
    this.proc.on('close', () => {
      const err = new Error('MCP child closed before response');
      for (const [, r] of this.pending)
        r({ jsonrpc: '2.0', id: -1, error: { code: -1, message: err.message } });
      this.pending.clear();
      this.closeRejecter?.(err);
    });
  }

  private onStdout(chunk: Buffer): void {
    this.buf += chunk.toString('utf8');
    const lines = this.buf.split('\n');
    this.buf = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let msg: JsonRpcResponse;
      try {
        msg = JSON.parse(trimmed) as JsonRpcResponse;
      } catch {
        continue; // ignore unparseable lines (should not happen w/ MCP SDK)
      }
      if (typeof msg.id === 'number') {
        const resolver = this.pending.get(msg.id);
        if (resolver) {
          this.pending.delete(msg.id);
          resolver(msg);
        }
      }
    }
  }

  async request(method: string, params: unknown): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    const done = new Promise<JsonRpcResponse>((resolve, reject) => {
      this.pending.set(id, resolve);
      this.closeRejecter = reject;
    });
    this.proc.stdin.write(payload + '\n');
    return done;
  }

  kill(): void {
    if (!this.proc.killed) this.proc.kill();
  }
}

/**
 * Extract the JSON payload from a tool/call response.
 *
 * Tool handlers in brs-gen return plain payload objects; the bootstrap
 * wraps them once at the MCP boundary as
 * `{ content: [{ type: 'text', text: JSON.stringify(handlerResult) }] }`.
 * A single JSON.parse on `content[0].text` yields the real payload.
 *
 * Failures from a thrown `Failure` land in the envelope with
 * `isError: true` and the Failure serialised in `content[0].text`.
 */
function parseToolPayload(result: unknown): Record<string, unknown> {
  const outer = result as {
    content?: Array<{ text?: string }>;
    isError?: boolean;
  };
  const outerText = outer.content?.[0]?.text;
  if (typeof outerText !== 'string') {
    throw new Error(`tool response missing text content: ${JSON.stringify(result)}`);
  }
  const parsed = JSON.parse(outerText) as Record<string, unknown>;
  if (outer.isError) {
    throw new Error(`tool returned isError: ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

describe('brs-gen e2e: MCP smoke + golden fixtures', () => {
  let client: McpChild;
  let parent: string;
  let outputDir: string;
  let zipPath: string;

  beforeEach(async () => {
    client = new McpChild();
    // Run the full initialize handshake before any tools/* calls.
    const initResp = await client.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'brs-gen-e2e', version: '1' },
    });
    if (initResp.error) {
      throw new Error(`initialize failed: ${JSON.stringify(initResp.error)}`);
    }
    parent = await mkdtemp(join(tmpdir(), 'brs-gen-e2e-'));
    outputDir = join(parent, 'project');
    zipPath = join(parent, 'project.zip');
  });

  afterEach(async () => {
    client.kill();
    await rm(parent, { recursive: true, force: true });
  });

  it('tools/list returns exactly the 10 Plan-3 tools', async () => {
    const resp = await client.request('tools/list', {});
    expect(resp.error).toBeUndefined();
    const tools = (resp.result as { tools: Array<{ name: string }> }).tools;
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(EXPECTED_TOOL_NAMES);
  }, 15_000);

  it('generate_app produces a byte-equal zip against the golden', async () => {
    const resp = await client.request('tools/call', {
      name: 'generate_app',
      arguments: {
        spec: CANONICAL_SPEC,
        output_dir: outputDir,
        zip: { output_zip: zipPath },
      },
    });
    expect(resp.error).toBeUndefined();
    const payload = parseToolPayload(resp.result);
    expect(payload['ok']).toBe(true);
    expect(payload['zip_path']).toBe(zipPath);

    const actual = await readFile(zipPath);
    const expected = await readFile(join(GOLDEN_DIR, 'stub.zip'));
    expect(actual.equals(expected)).toBe(true);
  }, 30_000);

  it('validate_manifest returns ok:true on the generated project', async () => {
    const gen = await client.request('tools/call', {
      name: 'generate_app',
      arguments: {
        spec: CANONICAL_SPEC,
        output_dir: outputDir,
        zip: { output_zip: zipPath },
      },
    });
    expect(gen.error).toBeUndefined();
    parseToolPayload(gen.result); // assert ok

    const vm = await client.request('tools/call', {
      name: 'validate_manifest',
      arguments: { project_dir: outputDir },
    });
    expect(vm.error).toBeUndefined();
    const payload = parseToolPayload(vm.result);
    expect(payload['ok']).toBe(true);
  }, 30_000);

  it('lint reports no errors on the generated project', async () => {
    // The post-compile sweep in compileProject patches uri="*.bs" to
    // uri="*.brs" in all XML files, so a second bsc pass (lint) finds the
    // correct .brs counterparts and reports no errors.
    const gen = await client.request('tools/call', {
      name: 'generate_app',
      arguments: {
        spec: CANONICAL_SPEC,
        output_dir: outputDir,
        zip: { output_zip: zipPath },
      },
    });
    expect(gen.error).toBeUndefined();
    parseToolPayload(gen.result);

    const lintResp = await client.request('tools/call', {
      name: 'lint',
      arguments: { project_dir: outputDir },
    });
    expect(lintResp.error).toBeUndefined();
    const payload = parseToolPayload(lintResp.result);
    expect(payload['ok']).toBe(true);
    expect((payload['diagnostics'] as any[]).filter((d: any) => d.severity === 'error')).toEqual(
      [],
    );
  }, 45_000);

  it('provenance.json byte-equals the golden', async () => {
    const gen = await client.request('tools/call', {
      name: 'generate_app',
      arguments: {
        spec: CANONICAL_SPEC,
        output_dir: outputDir,
        zip: { output_zip: zipPath },
      },
    });
    expect(gen.error).toBeUndefined();
    parseToolPayload(gen.result);

    const actual = await readFile(join(outputDir, '.rokudev-tools', 'provenance.json'));
    const expected = await readFile(join(GOLDEN_DIR, 'stub.provenance.json'));
    expect(actual.equals(expected)).toBe(true);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // video_grid_channel tests (T23)
  //
  // Option B: beforeAll generates the project once; all 3 tests share it.
  // The generate step is expensive (sharp resizes + bsc compile), so a single
  // shared run is materially faster than 3 independent runs.
  // ---------------------------------------------------------------------------
  describe('video_grid_channel', () => {
    const FIXTURES_DIR = join(PKG_ROOT, 'tests', '__fixtures__');

    // Inline spec with absolute asset paths so no spec file needs to be
    // written to disk. resolveAssetPath passes absolute paths through as-is.
    const VIDEO_GRID_SPEC = {
      spec_version: 2,
      template: 'video_grid_channel',
      modules: [],
      app: { name: 'Acme TV', major_version: 0, minor_version: 1, build_version: 0 },
      branding: {
        primary_color: '#E50914',
        icon: join(FIXTURES_DIR, 'icon-uhd.png'),
        splash: join(FIXTURES_DIR, 'splash-uhd.png'),
      },
      content: {
        feed_url: 'https://demo.avideo.com/roku.json',
        feed_format: 'roku_direct_publisher_json',
      },
    };

    let vgWorkDir: string;
    let vgOutputDir: string;
    let vgZipPath: string;
    let vgClient: McpChild;

    beforeAll(async () => {
      vgWorkDir = await mkdtemp(join(tmpdir(), 'brs-gen-e2e-vg-'));
      vgOutputDir = join(vgWorkDir, 'project');
      vgZipPath = join(vgWorkDir, 'project.zip');

      vgClient = new McpChild();
      const initResp = await vgClient.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'brs-gen-e2e-vg', version: '1' },
      });
      if (initResp.error) {
        throw new Error(`video_grid initialize failed: ${JSON.stringify(initResp.error)}`);
      }

      const gen = await vgClient.request('tools/call', {
        name: 'generate_app',
        arguments: {
          spec: VIDEO_GRID_SPEC,
          output_dir: vgOutputDir,
          zip: { output_zip: vgZipPath },
        },
      });
      if (gen.error) {
        throw new Error(`video_grid generate_app failed: ${JSON.stringify(gen.error)}`);
      }
      parseToolPayload(gen.result); // throws on isError
    }, 120_000);

    afterAll(async () => {
      vgClient.kill();
      await rm(vgWorkDir, { recursive: true, force: true });
    });

    it('generate_app on video_grid_channel produces byte-equal golden zip + provenance', async () => {
      const emitted = await readFile(vgZipPath);
      const golden = await readFile(join(GOLDEN_DIR, 'video-grid.zip'));
      expect(emitted.equals(golden)).toBe(true);

      const emittedProv = await readFile(join(vgOutputDir, '.rokudev-tools', 'provenance.json'));
      const goldenProv = await readFile(join(GOLDEN_DIR, 'video-grid.provenance.json'));
      expect(emittedProv.equals(goldenProv)).toBe(true);
    }, 10_000);

    it('validate_manifest returns ok:true on the video_grid_channel project', async () => {
      const vm = await vgClient.request('tools/call', {
        name: 'validate_manifest',
        arguments: { project_dir: vgOutputDir },
      });
      expect(vm.error).toBeUndefined();
      const payload = parseToolPayload(vm.result);
      expect(payload['ok']).toBe(true);
    }, 15_000);

    it('lint reports no errors on the video_grid_channel project', async () => {
      const lintResp = await vgClient.request('tools/call', {
        name: 'lint',
        arguments: { project_dir: vgOutputDir },
      });
      expect(lintResp.error).toBeUndefined();
      const payload = parseToolPayload(lintResp.result);
      expect(payload['ok']).toBe(true);
      expect((payload['diagnostics'] as any[]).filter((d: any) => d.severity === 'error')).toEqual(
        [],
      );
    }, 45_000);
  });

  // ---------------------------------------------------------------------------
  // blank_scenegraph tests (Plan 4a T10)
  //
  // Option B: beforeAll generates the project once; all 3 tests share it.
  // ---------------------------------------------------------------------------
  describe('blank_scenegraph', () => {
    const CANONICAL_BLANK_SPEC = {
      spec_version: 2,
      template: 'blank_scenegraph',
      modules: [],
      app: { name: 'Blank E2E', major_version: 0, minor_version: 1, build_version: 0 },
    };

    let blankWorkDir: string;
    let blankOutputDir: string;
    let blankZipPath: string;
    let blankClient: McpChild;

    beforeAll(async () => {
      blankWorkDir = await mkdtemp(join(tmpdir(), 'brs-gen-e2e-blank-'));
      blankOutputDir = join(blankWorkDir, 'project');
      blankZipPath = join(blankWorkDir, 'project.zip');

      blankClient = new McpChild();
      const initResp = await blankClient.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'brs-gen-e2e-blank', version: '1' },
      });
      if (initResp.error) {
        throw new Error(`blank_scenegraph initialize failed: ${JSON.stringify(initResp.error)}`);
      }

      const gen = await blankClient.request('tools/call', {
        name: 'generate_app',
        arguments: {
          spec: CANONICAL_BLANK_SPEC,
          output_dir: blankOutputDir,
          zip: { output_zip: blankZipPath },
        },
      });
      if (gen.error) {
        throw new Error(`blank_scenegraph generate_app failed: ${JSON.stringify(gen.error)}`);
      }
      parseToolPayload(gen.result); // throws on isError
    }, 60_000);

    afterAll(async () => {
      blankClient.kill();
      await rm(blankWorkDir, { recursive: true, force: true });
    });

    it('generate_app on blank_scenegraph produces byte-equal golden zip + provenance', async () => {
      const emitted = await readFile(blankZipPath);
      const golden = await readFile(join(GOLDEN_DIR, 'blank.zip'));
      expect(emitted.equals(golden)).toBe(true);

      const emittedProv = await readFile(join(blankOutputDir, '.rokudev-tools', 'provenance.json'));
      const goldenProv = await readFile(join(GOLDEN_DIR, 'blank.provenance.json'));
      expect(emittedProv.equals(goldenProv)).toBe(true);
    }, 10_000);

    it('validate_manifest returns ok:true on the blank_scenegraph project', async () => {
      const vm = await blankClient.request('tools/call', {
        name: 'validate_manifest',
        arguments: { project_dir: blankOutputDir },
      });
      expect(vm.error).toBeUndefined();
      const payload = parseToolPayload(vm.result);
      expect(payload['ok']).toBe(true);
    }, 15_000);

    it('lint reports no errors on the blank_scenegraph project', async () => {
      const lintResp = await blankClient.request('tools/call', {
        name: 'lint',
        arguments: { project_dir: blankOutputDir },
      });
      expect(lintResp.error).toBeUndefined();
      const payload = parseToolPayload(lintResp.result);
      expect(payload['ok']).toBe(true);
      expect(
        (payload['diagnostics'] as Array<{ severity: string }>).filter(
          (d) => d.severity === 'error',
        ),
      ).toEqual([]);
    }, 45_000);
  });
});
