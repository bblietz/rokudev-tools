import { describe, it, expect, beforeEach, vi } from 'vitest';

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

// Side-effect: register debug-introspect tools (runs with mocked exports).
await import('./debug-introspect.js');

import { registerAllTools, type ToolDef } from './_register.js';
import { _resetSessions, registerSession } from '../util/debug-session-registry.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tools: Map<string, ToolDef>;

beforeEach(() => {
  tools = new Map();
  registerAllTools(tools);
  for (const m of Object.values(mocks)) m.mockReset();
  _resetSessions();
});

function call(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const def = tools.get(name);
  if (!def) throw new Error(`tool ${name} not registered`);
  return def.handler(args);
}

function registerFakeSession(
  stubs: {
    threads?: ReturnType<typeof vi.fn>;
    stackTrace?: ReturnType<typeof vi.fn>;
    variables?: ReturnType<typeof vi.fn>;
    eval?: ReturnType<typeof vi.fn>;
  } = {},
): string {
  const session = {
    threads: stubs.threads ?? vi.fn().mockResolvedValue([]),
    stackTrace: stubs.stackTrace ?? vi.fn().mockResolvedValue([]),
    variables: stubs.variables ?? vi.fn().mockResolvedValue([]),
    eval: stubs.eval ?? vi.fn().mockResolvedValue({
      success: true,
      compileErrors: [],
      runtimeErrors: [],
      otherErrors: [],
    }),
    // Minimal stubs required by session registry typing.
    state: 'live',
    bdpVersion: { major: 3, minor: 0, patch: 0 },
    currentBreakpoints: vi.fn().mockReturnValue([]),
    detach: vi.fn(),
  } as unknown as import('@rokudev/device-client').BdpSession;
  return registerSession(session);
}

function fakeResolver(translation: { sourceFile: string; sourceLine: number } | null) {
  const dispose = vi.fn();
  const resolver = {
    toSource: vi.fn().mockReturnValue(translation),
    toCompiled: vi.fn(),
    dispose,
  };
  return { resolver, dispose };
}

// ---------------------------------------------------------------------------
// 1. Schema registration smoke
// ---------------------------------------------------------------------------

describe('debug introspect tool registration', () => {
  it('registers all 4 tools with expected shapes', () => {
    const expected: Record<string, string[]> = {
      debug_threads:     ['session_id'],
      debug_stack_trace: ['session_id', 'thread_id'],
      debug_variables:   ['session_id', 'thread_id', 'frame_idx'],
      debug_eval:        ['session_id', 'thread_id', 'frame_idx', 'expression'],
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
// 2. debug_threads happy path -- camelCase -> snake_case
// ---------------------------------------------------------------------------

describe('debug_threads happy path', () => {
  it('converts BdpThreadEntry camelCase fields to snake_case in output', async () => {
    const fakeThreads = [
      {
        id: 0,
        isPrimary: true,
        isDetached: false,
        stopReason: 'break' as const,
        stopReasonDetail: 'user breakpoint',
        line: 42,
        functionName: 'myFunction',
        file: 'pkg:/source/main.brs',
        codeSnippet: 'print "hello"',
      },
      {
        id: 1,
        isPrimary: false,
        isDetached: false,
        stopReason: 'not_stopped' as const,
        stopReasonDetail: '',
        line: 10,
        functionName: 'otherFunc',
        file: 'pkg:/source/other.brs',
        codeSnippet: '',
      },
    ];
    const threads = vi.fn().mockResolvedValue(fakeThreads);
    const sid = registerFakeSession({ threads });

    const result = (await call('debug_threads', { session_id: sid })) as Record<string, unknown>;

    expect(threads).toHaveBeenCalledTimes(1);
    expect(result['ok']).toBe(true);
    const out = result['threads'] as Array<Record<string, unknown>>;
    expect(out).toHaveLength(2);

    // First thread: all fields present
    expect(out[0]).toEqual({
      id: 0,
      is_primary: true,
      is_detached: false,
      stop_reason: 'break',
      stop_reason_detail: 'user breakpoint',
      line: 42,
      function_name: 'myFunction',
      file: 'pkg:/source/main.brs',
      code_snippet: 'print "hello"',
    });

    // Second thread: stop_reason_detail empty string still present
    expect(out[1]).toMatchObject({
      id: 1,
      is_primary: false,
      is_detached: false,
      stop_reason: 'not_stopped',
      stop_reason_detail: '',
      line: 10,
      function_name: 'otherFunc',
      file: 'pkg:/source/other.brs',
    });
  });
});

// ---------------------------------------------------------------------------
// 3. debug_stack_trace with source map present -- reverse translation
// ---------------------------------------------------------------------------

describe('debug_stack_trace with map present', () => {
  it('translates compiled to source coordinates and disposes resolver', async () => {
    const fakeFrames = [
      { idx: 0, file: '/main.brs', line: 25, functionName: 'myFunc' },
    ];
    const stackTrace = vi.fn().mockResolvedValue(fakeFrames);
    const sid = registerFakeSession({ stackTrace });

    const { resolver, dispose } = fakeResolver({ sourceFile: '/main.bs', sourceLine: 10 });
    mocks.findSourceMap.mockResolvedValue('/project/.roku-deploy-staging/main.brs.map');
    mocks.resolverFromMapFile.mockResolvedValue(resolver);

    const result = (await call('debug_stack_trace', {
      session_id: sid,
      thread_id: 0,
      project_root: '/project',
    })) as Record<string, unknown>;

    expect(result['ok']).toBe(true);
    const frames = result['frames'] as Array<Record<string, unknown>>;
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({
      idx: 0,
      function_name: 'myFunc',
      source_file: '/main.bs',
      source_line: 10,
      compiled_file: '/main.brs',
      compiled_line: 25,
    });

    // Verify findSourceMap was called for the .brs file
    expect(mocks.findSourceMap).toHaveBeenCalledWith('/main.brs', '/project');
    expect(mocks.resolverFromMapFile).toHaveBeenCalledWith('/project/.roku-deploy-staging/main.brs.map');
    expect(resolver.toSource).toHaveBeenCalledWith('/main.brs', 25);

    // CRITICAL: resolver.dispose() must be called (finally block)
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 4. debug_stack_trace without source map -- identity passthrough
// ---------------------------------------------------------------------------

describe('debug_stack_trace without map', () => {
  it('passes compiled coordinates as source when no map found', async () => {
    const fakeFrames = [
      { idx: 0, file: '/main.brs', line: 100 },
    ];
    const stackTrace = vi.fn().mockResolvedValue(fakeFrames);
    const sid = registerFakeSession({ stackTrace });

    mocks.findSourceMap.mockResolvedValue(null);

    const result = (await call('debug_stack_trace', {
      session_id: sid,
      thread_id: 0,
    })) as Record<string, unknown>;

    expect(result['ok']).toBe(true);
    const frames = result['frames'] as Array<Record<string, unknown>>;
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({
      idx: 0,
      source_file: '/main.brs',
      source_line: 100,
      compiled_file: '/main.brs',
      compiled_line: 100,
    });

    // No resolver should have been loaded
    expect(mocks.resolverFromMapFile).not.toHaveBeenCalled();
    // No dispose should have been called
  });
});

// ---------------------------------------------------------------------------
// 5. debug_stack_trace resolver caching
// ---------------------------------------------------------------------------

describe('debug_stack_trace resolver caching', () => {
  it('calls findSourceMap and fromMapFile only once for multiple frames in same file', async () => {
    const fakeFrames = [
      { idx: 0, file: '/main.brs', line: 10, functionName: 'funcA' },
      { idx: 1, file: '/main.brs', line: 20, functionName: 'funcB' },
      { idx: 2, file: '/main.brs', line: 30, functionName: 'funcC' },
    ];
    const stackTrace = vi.fn().mockResolvedValue(fakeFrames);
    const sid = registerFakeSession({ stackTrace });

    const { resolver } = fakeResolver({ sourceFile: '/main.bs', sourceLine: 5 });
    mocks.findSourceMap.mockResolvedValue('/project/main.brs.map');
    mocks.resolverFromMapFile.mockResolvedValue(resolver);

    await call('debug_stack_trace', { session_id: sid, thread_id: 0 });

    // findSourceMap called exactly once despite 3 frames with same file
    expect(mocks.findSourceMap).toHaveBeenCalledTimes(1);
    // fromMapFile called exactly once
    expect(mocks.resolverFromMapFile).toHaveBeenCalledTimes(1);
    // toSource called 3 times (once per frame)
    expect(resolver.toSource).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// 6. debug_stack_trace skips non-.brs files
// ---------------------------------------------------------------------------

describe('debug_stack_trace skips non-.brs files', () => {
  it('does not call findSourceMap for .bs frames or other extensions', async () => {
    const fakeFrames = [
      { idx: 0, file: '/main.bs', line: 10, functionName: 'funcA' },
      { idx: 1, file: '/other.xml', line: 5 },
    ];
    const stackTrace = vi.fn().mockResolvedValue(fakeFrames);
    const sid = registerFakeSession({ stackTrace });

    const result = (await call('debug_stack_trace', {
      session_id: sid,
      thread_id: 0,
    })) as Record<string, unknown>;

    // findSourceMap should NOT have been called for .bs or .xml files
    expect(mocks.findSourceMap).not.toHaveBeenCalled();
    expect(mocks.resolverFromMapFile).not.toHaveBeenCalled();

    const frames = result['frames'] as Array<Record<string, unknown>>;
    expect(frames).toHaveLength(2);
    // Both frames: source === compiled
    expect(frames[0]).toMatchObject({ source_file: '/main.bs', compiled_file: '/main.bs' });
    expect(frames[1]).toMatchObject({ source_file: '/other.xml', compiled_file: '/other.xml' });
  });
});

// ---------------------------------------------------------------------------
// 7. debug_variables happy path -- camelCase -> snake_case
// ---------------------------------------------------------------------------

describe('debug_variables happy path', () => {
  it('converts BdpVariable camelCase fields to snake_case in output', async () => {
    const fakeVars = [
      {
        name: 'myVar',
        type: 'String',
        value: 'hello',
        isConst: false,
        isContainer: false,
      },
      {
        name: 'myArray',
        type: 'Array',
        value: null,
        isContainer: true,
        childCount: 3,
        keyType: 'Integer',
        isChildKey: false,
        isVirtual: false,
        refCount: 1,
      },
    ];
    const variables = vi.fn().mockResolvedValue(fakeVars);
    const sid = registerFakeSession({ variables });

    const result = (await call('debug_variables', {
      session_id: sid,
      thread_id: 0,
      frame_idx: 0,
    })) as Record<string, unknown>;

    expect(variables).toHaveBeenCalledWith(0, 0, {});
    expect(result['ok']).toBe(true);
    const out = result['variables'] as Array<Record<string, unknown>>;
    expect(out).toHaveLength(2);

    // First var: primitive, optional fields omitted when undefined/absent
    expect(out[0]).toMatchObject({
      name: 'myVar',
      type: 'String',
      value: 'hello',
      is_const: false,
      is_container: false,
    });

    // Second var: container, all fields present
    expect(out[1]).toMatchObject({
      name: 'myArray',
      type: 'Array',
      value: null,
      is_container: true,
      child_count: 3,
      key_type: 'Integer',
      is_child_key: false,
      is_virtual: false,
      ref_count: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// 8. debug_variables propagates get_children and var_path
// ---------------------------------------------------------------------------

describe('debug_variables option propagation', () => {
  it('passes getChildKeys and varPath through to session.variables', async () => {
    const variables = vi.fn().mockResolvedValue([]);
    const sid = registerFakeSession({ variables });

    await call('debug_variables', {
      session_id: sid,
      thread_id: 2,
      frame_idx: 1,
      get_children: true,
      var_path: ['a', 'b'],
    });

    expect(variables).toHaveBeenCalledWith(2, 1, {
      getChildKeys: true,
      varPath: ['a', 'b'],
    });
  });
});

// ---------------------------------------------------------------------------
// 9. debug_eval happy path
// ---------------------------------------------------------------------------

describe('debug_eval happy path', () => {
  it('returns success and empty error arrays', async () => {
    const evalFn = vi.fn().mockResolvedValue({
      success: true,
      compileErrors: [],
      runtimeErrors: [],
      otherErrors: [],
    });
    const sid = registerFakeSession({ eval: evalFn });

    const result = (await call('debug_eval', {
      session_id: sid,
      thread_id: 0,
      frame_idx: 0,
      expression: 'x = 42',
    })) as Record<string, unknown>;

    expect(evalFn).toHaveBeenCalledWith(0, 0, 'x = 42', {});
    expect(result).toMatchObject({
      ok: true,
      success: true,
      runtime_stop_reason: null,
      compile_errors: [],
      runtime_errors: [],
      other_errors: [],
    });
  });
});

// ---------------------------------------------------------------------------
// 10. debug_eval surfaces compile errors
// ---------------------------------------------------------------------------

describe('debug_eval compile errors', () => {
  it('propagates compile_errors in response', async () => {
    const evalFn = vi.fn().mockResolvedValue({
      success: false,
      compileErrors: ['syntax error at line 1', 'undefined identifier'],
      runtimeErrors: [],
      otherErrors: [],
    });
    const sid = registerFakeSession({ eval: evalFn });

    const result = (await call('debug_eval', {
      session_id: sid,
      thread_id: 0,
      frame_idx: 0,
      expression: 'bad syntax !!!',
    })) as Record<string, unknown>;

    expect(result['ok']).toBe(true);
    expect(result['success']).toBe(false);
    expect(result['compile_errors']).toEqual(['syntax error at line 1', 'undefined identifier']);
    expect(result['runtime_errors']).toEqual([]);
    expect(result['other_errors']).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 11. debug_eval honors timeout_ms
// ---------------------------------------------------------------------------

describe('debug_eval timeout_ms propagation', () => {
  it('passes timeoutMs to session.eval when timeout_ms is provided', async () => {
    const evalFn = vi.fn().mockResolvedValue({
      success: true,
      compileErrors: [],
      runtimeErrors: [],
      otherErrors: [],
    });
    const sid = registerFakeSession({ eval: evalFn });

    await call('debug_eval', {
      session_id: sid,
      thread_id: 1,
      frame_idx: 2,
      expression: 'print x',
      timeout_ms: 5000,
    });

    expect(evalFn).toHaveBeenCalledWith(1, 2, 'print x', { timeoutMs: 5000 });
  });
});

// ---------------------------------------------------------------------------
// 12. Unknown session_id throws BDP_THREAD_LOST
// ---------------------------------------------------------------------------

describe('unknown session_id throws BDP_THREAD_LOST', () => {
  it('debug_threads throws BDP_THREAD_LOST for unknown session', async () => {
    await expect(
      call('debug_threads', { session_id: 'nonexistent' }),
    ).rejects.toMatchObject({ ok: false, code: 'BDP_THREAD_LOST' });
  });

  it('debug_stack_trace throws BDP_THREAD_LOST for unknown session', async () => {
    await expect(
      call('debug_stack_trace', { session_id: 'nonexistent', thread_id: 0 }),
    ).rejects.toMatchObject({ ok: false, code: 'BDP_THREAD_LOST' });
  });

  it('debug_variables throws BDP_THREAD_LOST for unknown session', async () => {
    await expect(
      call('debug_variables', { session_id: 'nonexistent', thread_id: 0, frame_idx: 0 }),
    ).rejects.toMatchObject({ ok: false, code: 'BDP_THREAD_LOST' });
  });

  it('debug_eval throws BDP_THREAD_LOST for unknown session', async () => {
    await expect(
      call('debug_eval', { session_id: 'nonexistent', thread_id: 0, frame_idx: 0, expression: 'x' }),
    ).rejects.toMatchObject({ ok: false, code: 'BDP_THREAD_LOST' });
  });
});
