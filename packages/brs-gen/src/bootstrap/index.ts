import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { checkSiblings, type VersionState } from './version-check.js';

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

export async function runServer(): Promise<void> {
  const versionResult: VersionState = await checkSiblings(import.meta.url);
  const version = await readServerVersion();

  const server = new Server(
    { name: 'brs-gen', version },
    { capabilities: { tools: {} } },
  );

  // TODO(T20+): register tools via REGISTRARS pattern.
  void versionResult;

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
