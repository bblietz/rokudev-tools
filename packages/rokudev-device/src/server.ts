import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { registerAllTools, type ToolDef } from './tools/_register.js';

export async function runServer(): Promise<void> {
  const server = new Server(
    { name: 'rokudev-device', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );
  const tools = new Map<string, ToolDef>();
  registerAllTools(tools);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...tools.values()].map((t) => ({
      name: t.name, description: t.description, inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const def = tools.get(req.params.name);
    if (!def) throw new Error(`unknown tool: ${req.params.name}`);
    const result = await def.handler(req.params.arguments ?? {});
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  await server.connect(new StdioServerTransport());
}
