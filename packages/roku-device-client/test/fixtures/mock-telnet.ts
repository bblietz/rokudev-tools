import { createServer, type Server } from 'node:net';

export async function startMockTelnet(
  emit: string[],
): Promise<{ server: Server; port: number; closeAll: () => Promise<void> }> {
  const server = createServer((sock) => {
    for (const line of emit) sock.write(`${line}\n`);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const closeAll = () => new Promise<void>((r) => server.close(() => r()));
  return { server, port, closeAll };
}
