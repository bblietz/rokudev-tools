import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Hoisted mock factories -- declared before vi.mock() factories run.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  findSourceMap: vi.fn(),
  resolverFromMapFile: vi.fn(),
}));

// Swap findSourceMap and SourceMapResolver; keep all other exports real.
vi.mock('@rokudev/device-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rokudev/device-client')>();
  return {
    ...actual,
    findSourceMap: mocks.findSourceMap,
    SourceMapResolver: { fromMapFile: mocks.resolverFromMapFile },
  };
});

// Side-effect: register debug-breakpoints tools (runs with mocked exports).
await import('./debug-breakpoints.js');

import { registerAllTools, type ToolDef } from './_register.js';
import { _resetSessions, registerSession } from '../util/debug-session-registry.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;
let tools: Map<string, ToolDef>;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'rokudev-dbgbp-'));
  process.env['ROKUDEV_CONFIG_DIR'] = tmpDir;
  tools = new Map();
  registerAllTools(tools);
  for (const m of Object.values(mocks)) m.mockReset();
  _resetSessions();
});

afterEach(async () => {
  delete process.env['ROKUDEV_CONFIG_DIR'];
  await rm(tmpDir, { recursive: true, force: true });
});

function call(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const def = tools.get(name);
  if (!def) throw new Error(`tool ${name} not registered`);
  return def.handler(args);
}

// Helper: register a fake session whose methods are stubs we can configure per-test.
function registerFakeSession(
  stubs: {
    setBreakpoint?: ReturnType<typeof vi.fn>;
    clearBreakpoint?: ReturnType<typeof vi.fn>;
    listBreakpoints?: ReturnType<typeof vi.fn>;
  } = {},
): string {
  const session = {
    setBreakpoint: stubs.setBreakpoint ?? vi.fn().mockResolvedValue({ id: 1 }),
    clearBreakpoint: stubs.clearBreakpoint ?? vi.fn().mockResolvedValue(undefined),
    listBreakpoints: stubs.listBreakpoints ?? vi.fn().mockResolvedValue([]),
    // Minimal stubs required by session registry typing.
    state: 'live',
    bdpVersion: { major: 3, minor: 0, patch: 0 },
    currentBreakpoints: vi.fn().mockReturnValue([]),
    detach: vi.fn(),
  } as unknown as import('@rokudev/device-client').BdpSession;
  return registerSession(session);
}

function fakeResolver(translation: { compiledFile: string; compiledLine: number } | null) {
  const dispose = vi.fn();
  const resolver = {
    toCompiled: vi.fn().mockReturnValue(translation),
    dispose,
  };
  return { resolver, dispose };
}

// ---------------------------------------------------------------------------
// 1. Schema registration smoke
// ---------------------------------------------------------------------------

describe('debug breakpoint tool registration', () => {
  it('registers all 3 tools with expected shapes', () => {
    const expected: Record<string, string[]> = {
      debug_set_breakpoint: ['session_id', 'file', 'line'],
      debug_clear_breakpoint: ['session_id', 'id'],
      debug_list_breakpoints: ['session_id'],
    };

    for (const [name, required] of Object.entries(expected)) {
      expect(tools.has(name), `${name} not registered`).toBe(true);
      const def = tools.get(name)!;
      expect(typeof def.name).toBe('string');
      expect(typeof def.description).toBe('string');
      expect(def.inputSchema).toBeDefined();
      const schema = def.inputSchema as Record<string, unknown>;
      expect(schema['type']).toBe('object');
      expect(typeof def.handler).toBe('function');
      expect(schema['required']).toEqual(expect.arrayContaining(required));
    }
  });
});

// ---------------------------------------------------------------------------
// 2. .brs file: no source map lookup, direct pass-through
// ---------------------------------------------------------------------------

describe('debug_set_breakpoint with .brs file', () => {
  it('does not call findSourceMap; passes file/line directly to session', async () => {
    const setBreakpoint = vi.fn().mockResolvedValue({ id: 7 });
    const sid = registerFakeSession({ setBreakpoint });

    const result = (await call('debug_set_breakpoint', {
      session_id: sid,
      file: '/main.brs',
      line: 10,
    })) as Record<string, unknown>;

    expect(mocks.findSourceMap).not.toHaveBeenCalled();
    expect(setBreakpoint).toHaveBeenCalledWith('/main.brs', 10);
    expect(result).toEqual({
      ok: true,
      id: 7,
      source: { file: '/main.brs', line: 10 },
      compiled: { file: '/main.brs', line: 10 },
    });
  });
});

// ---------------------------------------------------------------------------
// 3. .bs file with map: forward translation
// ---------------------------------------------------------------------------

describe('debug_set_breakpoint with .bs file and source map', () => {
  it('translates source to compiled coordinates and disposes resolver', async () => {
    const setBreakpoint = vi.fn().mockResolvedValue({ id: 42 });
    const sid = registerFakeSession({ setBreakpoint });

    const { resolver, dispose } = fakeResolver({ compiledFile: '/main.brs', compiledLine: 25 });
    mocks.findSourceMap.mockResolvedValue('/project/.roku-deploy-staging/main.brs.map');
    mocks.resolverFromMapFile.mockResolvedValue(resolver);

    const result = (await call('debug_set_breakpoint', {
      session_id: sid,
      file: '/main.bs',
      line: 10,
    })) as Record<string, unknown>;

    expect(mocks.findSourceMap).toHaveBeenCalledWith('/main.bs', undefined);
    expect(mocks.resolverFromMapFile).toHaveBeenCalledWith(
      '/project/.roku-deploy-staging/main.brs.map',
    );
    expect(resolver.toCompiled).toHaveBeenCalledWith('/main.bs', 10);
    expect(setBreakpoint).toHaveBeenCalledWith('/main.brs', 25);
    expect(result).toEqual({
      ok: true,
      id: 42,
      source: { file: '/main.bs', line: 10 },
      compiled: { file: '/main.brs', line: 25 },
    });
    // CRITICAL: resolver.dispose() must be called (finally block).
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 4. .bs file without map: BDP_NO_SOURCE_MAP with EXACT hint
// ---------------------------------------------------------------------------

describe('debug_set_breakpoint with .bs file and no source map', () => {
  it('throws BDP_NO_SOURCE_MAP with exact verbatim hint string', async () => {
    const sid = registerFakeSession();
    mocks.findSourceMap.mockResolvedValue(null);

    await expect(
      call('debug_set_breakpoint', { session_id: sid, file: '/main.bs', line: 10 }),
    ).rejects.toMatchObject({
      ok: false,
      code: 'BDP_NO_SOURCE_MAP',
      stage: 'debug',
      details: {
        file: '/main.bs',
        hint: 'set sourceMap: true in bsconfig.json and re-build',
      },
    });

    // Verify the hint string BYTE-FOR-BYTE.
    let caught: unknown;
    try {
      await call('debug_set_breakpoint', { session_id: sid, file: '/main.bs', line: 10 });
    } catch (e) {
      caught = e;
    }
    const err = caught as { details?: { hint?: string } };
    expect(err.details?.hint).toBe('set sourceMap: true in bsconfig.json and re-build');
  });
});

// ---------------------------------------------------------------------------
// 5. .bs file with map but mapping returns null: BDP_BREAKPOINT_INVALID
// ---------------------------------------------------------------------------

describe('debug_set_breakpoint with .bs file and null translation', () => {
  it('throws BDP_BREAKPOINT_INVALID and still calls resolver.dispose()', async () => {
    const sid = registerFakeSession();

    const { resolver, dispose } = fakeResolver(null);
    mocks.findSourceMap.mockResolvedValue('/project/.roku-deploy-staging/main.brs.map');
    mocks.resolverFromMapFile.mockResolvedValue(resolver);

    await expect(
      call('debug_set_breakpoint', { session_id: sid, file: '/main.bs', line: 10 }),
    ).rejects.toMatchObject({
      ok: false,
      code: 'BDP_BREAKPOINT_INVALID',
      stage: 'debug',
      details: { file: '/main.bs', line: 10 },
    });

    // CRITICAL: resolver.dispose() must still be called (finally block).
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 6. debug_clear_breakpoint happy path
// ---------------------------------------------------------------------------

describe('debug_clear_breakpoint happy path', () => {
  it('calls session.clearBreakpoint and returns ok', async () => {
    const clearBreakpoint = vi.fn().mockResolvedValue(undefined);
    const sid = registerFakeSession({ clearBreakpoint });

    const result = (await call('debug_clear_breakpoint', {
      session_id: sid,
      id: 42,
    })) as Record<string, unknown>;

    expect(clearBreakpoint).toHaveBeenCalledWith(42);
    expect(result).toEqual({ ok: true, session_id: sid, id: 42 });
  });
});

// ---------------------------------------------------------------------------
// 7. debug_list_breakpoints happy path
// ---------------------------------------------------------------------------

describe('debug_list_breakpoints happy path', () => {
  it('returns breakpoints from session', async () => {
    const bps = [{ id: 1, file: '/x.brs', line: 5 }];
    const listBreakpoints = vi.fn().mockResolvedValue(bps);
    const sid = registerFakeSession({ listBreakpoints });

    const result = (await call('debug_list_breakpoints', {
      session_id: sid,
    })) as Record<string, unknown>;

    expect(listBreakpoints).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, session_id: sid, breakpoints: bps });
  });
});

// ---------------------------------------------------------------------------
// 8. Unknown session_id throws BDP_THREAD_LOST
// ---------------------------------------------------------------------------

describe('unknown session_id', () => {
  it('debug_set_breakpoint throws BDP_THREAD_LOST for unknown session', async () => {
    await expect(
      call('debug_set_breakpoint', { session_id: 'nonexistent', file: '/main.brs', line: 1 }),
    ).rejects.toMatchObject({ ok: false, code: 'BDP_THREAD_LOST' });
  });

  it('debug_clear_breakpoint throws BDP_THREAD_LOST for unknown session', async () => {
    await expect(
      call('debug_clear_breakpoint', { session_id: 'nonexistent', id: 1 }),
    ).rejects.toMatchObject({ ok: false, code: 'BDP_THREAD_LOST' });
  });

  it('debug_list_breakpoints throws BDP_THREAD_LOST for unknown session', async () => {
    await expect(
      call('debug_list_breakpoints', { session_id: 'nonexistent' }),
    ).rejects.toMatchObject({ ok: false, code: 'BDP_THREAD_LOST' });
  });
});
