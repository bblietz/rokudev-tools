import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { registerAllTools, type ToolDef } from './tools/_register.js';
import { checkSiblings, type VersionState } from './bootstrap/version-check.js';

export async function runServer(): Promise<void> {
  const server = new Server(
    { name: 'rokudev-device', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );
  const tools = new Map<string, ToolDef>();
  registerAllTools(tools);

  // Bootstrap version compatibility check — runs once before first tool call.
  let versionState: VersionState = await checkSiblings(import.meta.url);

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
      return { content: [{ type: 'text', text: JSON.stringify(versionState.failure) }] };
    }
    const def = tools.get(req.params.name);
    if (!def) throw new Error(`unknown tool: ${req.params.name}`);
    const result = await def.handler(req.params.arguments ?? {});

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

  await server.connect(new StdioServerTransport());
}
