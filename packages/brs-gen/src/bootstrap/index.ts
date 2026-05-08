import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { checkSiblings, type VersionState } from './version-check.js';
import { loadCatalog } from '../catalog/loader.js';
import { setCatalog } from '../tools/_catalog-singleton.js';
import { registerAllTools, type ToolDef } from '../tools/_register.js';

async function readServerVersion(): Promise<string> {
  const myDir = dirname(fileURLToPath(import.meta.url));
  // Walk up from src/bootstrap/ or dist/ to find package.json.
  for (const dir of [myDir, resolve(myDir, '..'), resolve(myDir, '../..')]) {
    try {
      const pkg = JSON.parse(await readFile(resolve(dir, 'package.json'), 'utf8')) as {
        version?: string;
      };
      if (pkg.version) return pkg.version;
    } catch {
      // continue
    }
  }
  return '0.0.0';
}

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
  const version = await readServerVersion();

  // Compute the package root (packages/brs-gen/) — works both from src/bootstrap/
  // at test/dev time and from dist/ at runtime.
  const bundledRoot = fileURLToPath(new URL('../../', import.meta.url));
  const catalog = await loadCatalog(bundledRoot);
  setCatalog(catalog);

  // Side-effect imports register all tools into REGISTRARS.
  await import('../tools/all.js');

  const tools = new Map<string, ToolDef>();
  registerAllTools(tools);

  const server = new Server(
    { name: 'brs-gen', version },
    { capabilities: { tools: {} } },
  );

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
      return { isError: true, content: [{ type: 'text', text: JSON.stringify(versionState.failure) }] };
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
