import { describe, it, expect } from 'vitest';
import { TelnetClient, type TelnetPort } from './client.js';
import { startMockTelnet } from '../../test/fixtures/mock-telnet.js';

describe('TelnetClient.tail', () => {
  it('returns lines emitted by the mock server', async () => {
    const m = await startMockTelnet(['hello', 'world']);
    try {
      // Cast port to TelnetPort to satisfy the signature; behaviorally any port works.
      const lines = await new TelnetClient().tail('127.0.0.1', m.port as TelnetPort, 1);
      expect(lines).toEqual(expect.arrayContaining(['hello', 'world']));
    } finally {
      await m.closeAll();
    }
  });

  it('times out cleanly when the producer is silent', async () => {
    const m = await startMockTelnet([]); // no lines
    try {
      const start = Date.now();
      const lines = await new TelnetClient().tail('127.0.0.1', m.port as TelnetPort, 1);
      const elapsed = Date.now() - start;
      expect(lines).toEqual([]);
      expect(elapsed).toBeGreaterThanOrEqual(900);
      expect(elapsed).toBeLessThan(2000);
    } finally {
      await m.closeAll();
    }
  });

  it('rejects with DEVICE_UNREACHABLE when the port is closed', async () => {
    // Use a port that is unlikely to have a listener. Pick a high random.
    const closedPort = 1; // privileged port; ECONNREFUSED on most systems
    await expect(new TelnetClient().tail('127.0.0.1', closedPort as TelnetPort, 1))
      .rejects.toMatchObject({ code: 'DEVICE_UNREACHABLE' });
  });
});
