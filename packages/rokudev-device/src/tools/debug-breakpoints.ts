import { registerToolsModule, type ToolDef } from './_register.js';
import { fail, findSourceMap, SourceMapResolver } from '@rokudev/device-client';
import { getSession } from '../util/debug-session-registry.js';

function tool(t: ToolDef): ToolDef {
  return t;
}

registerToolsModule((tools) => {
  tools.set(
    'debug_set_breakpoint',
    tool({
      name: 'debug_set_breakpoint',
      description:
        'Set a breakpoint at a specific file and line in the active BDP debug session. ' +
        'For BrighterScript (.bs) files, automatically resolves source-map coordinates to the ' +
        'compiled .brs file. Returns the assigned breakpoint ID and both source and compiled locations.',
      inputSchema: {
        type: 'object',
        properties: {
          session_id: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          project_root: { type: 'string' },
        },
        required: ['session_id', 'file', 'line'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const session = getSession(args['session_id'] as string);
        const file = args['file'] as string;
        const line = args['line'] as number;
        const projectRoot = args['project_root'] as string | undefined;

        let compiledFile = file;
        let compiledLine = line;

        if (file.endsWith('.bs')) {
          const mapPath = await findSourceMap(file, projectRoot);
          if (!mapPath) {
            throw fail(
              'BDP_NO_SOURCE_MAP',
              `no .brs.map found for ${file}`,
              {
                file,
                hint: 'set sourceMap: true in bsconfig.json and re-build',
              },
            );
          }
          const resolver = await SourceMapResolver.fromMapFile(mapPath);
          try {
            const translated = resolver.toCompiled(file, line);
            if (!translated) {
              throw fail(
                'BDP_BREAKPOINT_INVALID',
                `cannot translate ${file}:${line} via source map`,
                { file, line },
              );
            }
            compiledFile = translated.compiledFile;
            compiledLine = translated.compiledLine;
          } finally {
            resolver.dispose();
          }
        }

        const { id } = await session.setBreakpoint(compiledFile, compiledLine);
        return {
          ok: true,
          id,
          source: { file, line },
          compiled: { file: compiledFile, line: compiledLine },
        };
      },
    }),
  );

  tools.set(
    'debug_clear_breakpoint',
    tool({
      name: 'debug_clear_breakpoint',
      description:
        'Clear (remove) a breakpoint by its ID from the active BDP debug session.',
      inputSchema: {
        type: 'object',
        properties: {
          session_id: { type: 'string' },
          id: { type: 'number' },
        },
        required: ['session_id', 'id'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const session = getSession(args['session_id'] as string);
        await session.clearBreakpoint(args['id'] as number);
        return { ok: true, session_id: args['session_id'], id: args['id'] };
      },
    }),
  );

  tools.set(
    'debug_list_breakpoints',
    tool({
      name: 'debug_list_breakpoints',
      description:
        'List all active breakpoints in the BDP debug session. Returns each breakpoint with ' +
        'its ID, file, and line number. Only breakpoints set via this session are returned; ' +
        'breakpoints set outside the session (e.g. from another client) are not visible.',
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
        const breakpoints = await session.listBreakpoints();
        return { ok: true, session_id: args['session_id'], breakpoints };
      },
    }),
  );
});
