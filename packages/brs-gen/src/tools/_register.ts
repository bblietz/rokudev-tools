export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
export type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
};

const REGISTRARS: ((tools: Map<string, ToolDef>) => void)[] = [];

export function registerToolsModule(fn: (tools: Map<string, ToolDef>) => void): void {
  REGISTRARS.push(fn);
}

export function registerAllTools(tools: Map<string, ToolDef>): void {
  for (const r of REGISTRARS) r(tools);
}
