import { registerToolsModule, type ToolDef } from './_register.js';
import { findSourceMap, SourceMapResolver } from '@rokudev/device-client';
import { getSession } from '../util/debug-session-registry.js';
import type { BdpVariable } from '@rokudev/device-client';

function tool(t: ToolDef): ToolDef { return t; }

/** Remove keys whose value is undefined from an object (shallow). */
function omitUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** Convert BdpVariable fields from camelCase to snake_case, omitting undefined fields. */
function mapVariable(v: BdpVariable): Record<string, unknown> {
  return omitUndefined({
    name: v.name,
    type: v.type,
    value: v.value,
    is_child_key: v.isChildKey,
    is_const: v.isConst,
    is_container: v.isContainer,
    child_count: v.childCount,
    key_type: v.keyType,
    ref_count: v.refCount,
    is_virtual: v.isVirtual,
  } as Record<string, unknown>);
}

registerToolsModule((tools) => {
  // -------------------------------------------------------------------------
  // debug_threads
  // -------------------------------------------------------------------------

  tools.set('debug_threads', tool({
    name: 'debug_threads',
    description:
      'Retrieve all threads currently known to the BDP debugger. ' +
      'Each entry includes stop reason, file/line at the stop point, and a source snippet.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
      },
      required: ['session_id'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const session = getSession(args['session_id'] as string);
      const threads = await session.threads();
      const threadsOut = threads.map((t) => omitUndefined({
        id: t.id,
        is_primary: t.isPrimary,
        is_detached: t.isDetached,
        stop_reason: t.stopReason,
        stop_reason_detail: t.stopReasonDetail,
        line: t.line,
        function_name: t.functionName,
        file: t.file,
        code_snippet: t.codeSnippet,
      } as Record<string, unknown>));
      return { ok: true, threads: threadsOut };
    },
  }));

  // -------------------------------------------------------------------------
  // debug_stack_trace
  // -------------------------------------------------------------------------

  tools.set('debug_stack_trace', tool({
    name: 'debug_stack_trace',
    description:
      'Retrieve the call stack for a specific thread. ' +
      'For .brs frames, automatically performs reverse source-map translation to recover .bs source ' +
      'coordinates. Each frame carries both compiled and source file/line.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        thread_id: { type: 'integer' },
        project_root: { type: 'string' },
      },
      required: ['session_id', 'thread_id'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const session = getSession(args['session_id'] as string);
      const threadId = args['thread_id'] as number;
      const projectRoot = args['project_root'] as string | undefined;
      const frames = await session.stackTrace(threadId);

      // resolver cache: compiled file path -> SourceMapResolver | null
      // null means "we tried findSourceMap and it returned null"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resolverCache = new Map<string, any>();

      try {
        const out: Record<string, unknown>[] = [];

        for (const frame of frames) {
          let sourceFile = frame.file;
          let sourceLine = frame.line;

          // Only attempt source-map lookup for .brs files
          if (frame.file.endsWith('.brs')) {
            let resolver = resolverCache.get(frame.file);

            if (resolver === undefined) {
              // Cache miss: try to find and load the map
              const mapPath = await findSourceMap(frame.file, projectRoot);
              if (mapPath) {
                try {
                  resolver = await SourceMapResolver.fromMapFile(mapPath);
                } catch {
                  resolver = null;
                }
              } else {
                resolver = null;
              }
              resolverCache.set(frame.file, resolver);
            }

            if (resolver) {
              const translated = resolver.toSource(frame.file, frame.line);
              if (translated) {
                sourceFile = translated.sourceFile;
                sourceLine = translated.sourceLine;
              }
            }
          } else {
            // Non-.brs file: cache null immediately to avoid spurious retries
            if (!resolverCache.has(frame.file)) {
              resolverCache.set(frame.file, null);
            }
          }

          out.push(omitUndefined({
            idx: frame.idx,
            function_name: frame.functionName,
            source_file: sourceFile,
            source_line: sourceLine,
            compiled_file: frame.file,
            compiled_line: frame.line,
          } as Record<string, unknown>));
        }

        return { ok: true, frames: out };
      } finally {
        // Dispose all loaded resolvers
        for (const r of resolverCache.values()) {
          if (r) r.dispose();
        }
      }
    },
  }));

  // -------------------------------------------------------------------------
  // debug_variables
  // -------------------------------------------------------------------------

  tools.set('debug_variables', tool({
    name: 'debug_variables',
    description:
      'Retrieve the variables in scope for a specific thread and stack frame. ' +
      'Use var_path to navigate into container variables. ' +
      'Set get_children to true to include child key entries.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        thread_id: { type: 'integer' },
        frame_idx: { type: 'integer' },
        var_path: { type: 'array', items: { type: 'string' } },
        get_children: { type: 'boolean' },
      },
      required: ['session_id', 'thread_id', 'frame_idx'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const session = getSession(args['session_id'] as string);
      const threadId = args['thread_id'] as number;
      const frameIdx = args['frame_idx'] as number;

      const opts: { getChildKeys?: boolean; varPath?: string[] } = {};
      if (args['get_children'] !== undefined) {
        opts.getChildKeys = args['get_children'] as boolean;
      }
      if (args['var_path'] !== undefined) {
        opts.varPath = args['var_path'] as string[];
      }

      const variables = await session.variables(threadId, frameIdx, opts);
      return { ok: true, variables: variables.map(mapVariable) };
    },
  }));

  // -------------------------------------------------------------------------
  // debug_eval
  // -------------------------------------------------------------------------

  tools.set('debug_eval', tool({
    name: 'debug_eval',
    description:
      'Evaluate a BrightScript expression in the context of a specific thread and stack frame. ' +
      'Returns success/error status. Variable values produced by the expression are NOT returned ' +
      'directly -- use debug_variables after a successful eval to inspect them.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        thread_id: { type: 'integer' },
        frame_idx: { type: 'integer' },
        expression: { type: 'string' },
        timeout_ms: { type: 'integer' },
      },
      required: ['session_id', 'thread_id', 'frame_idx', 'expression'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const session = getSession(args['session_id'] as string);
      const threadId = args['thread_id'] as number;
      const frameIdx = args['frame_idx'] as number;
      const expression = args['expression'] as string;

      const opts: { timeoutMs?: number } = {};
      if (args['timeout_ms'] !== undefined) {
        opts.timeoutMs = args['timeout_ms'] as number;
      }

      const res = await session.eval(threadId, frameIdx, expression, opts);
      return {
        ok: true,
        success: res.success,
        runtime_stop_reason: res.runtimeStopReason ?? null,
        compile_errors: res.compileErrors,
        runtime_errors: res.runtimeErrors,
        other_errors: res.otherErrors,
      };
    },
  }));
});
