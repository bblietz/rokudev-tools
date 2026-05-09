import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { checkSiblings, type VersionState } from './version-check.js';
import { loadCatalog } from '../catalog/loader.js';
import { setCatalog } from '../tools/_catalog-singleton.js';
import { registerAllTools, type ToolDef } from '../tools/_register.js';
import { findPkgRoot, readPkgVersion } from '../util/paths.js';

function isFailure(v: unknown): v is { ok: false; code: string; message: string } {
  return (
    v !== null &&
    typeof v === 'object' &&
    (v as Record<string, unknown>)['ok'] === false &&
    typeof (v as Record<string, unknown>)['code'] === 'string'
  );
}

export async function runServer(): Promise<void> {
  const versionResult: VersionState = await checkSiblings(import.meta.url);

  // Compute the package root (packages/brs-gen/) — works both from
  // src/bootstrap/ (vite-node) and dist/bootstrap/ (published).
  const bundledRoot = await findPkgRoot(import.meta.url);
  const version = await readPkgVersion(bundledRoot);
  const catalog = await loadCatalog(bundledRoot);
  setCatalog(catalog);

  // Side-effect imports register all tools into REGISTRARS.
  await import('../tools/all.js');

  const tools = new Map<string, ToolDef>();
  registerAllTools(tools);

  const server = new Server({ name: 'brs-gen', version }, { capabilities: { tools: {} } });

  let versionState: VersionState = versionResult;

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (versionState.ok === false) {
      // Short-circuit every call with the bootstrap failure.
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify(versionState.failure) }],
      };
    }
    const def = tools.get(req.params.name);
    if (!def) throw new Error(`unknown tool: ${req.params.name}`);

    let result: unknown;
    try {
      result = await def.handler(req.params.arguments ?? {});
    } catch (e) {
      if (isFailure(e)) {
        return { isError: true, content: [{ type: 'text', text: JSON.stringify(e) }] };
      }
      throw e;
    }

    // One-shot warning splice: attach drift warning to the first response after startup, then clear it.
    if ('warning' in versionState) {
      const w = versionState.warning;
      versionState = { ok: true };
      const r = (result ?? {}) as { details?: { warnings?: unknown[] } };
      const details = r.details ?? {};
      const warnings = Array.isArray(details.warnings) ? [...details.warnings, w] : [w];
      const merged = { ...(result as Record<string, unknown>), details: { ...details, warnings } };
      return { content: [{ type: 'text', text: JSON.stringify(merged) }] };
    }

    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
