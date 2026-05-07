import { readFile } from 'node:fs/promises';
import { devicesPath } from './paths.js';
import { parseRegistry } from './parse.js';
import type { Registry } from './types.js';

export class RegistryReader {
  async read(): Promise<Registry> {
    try {
      const text = await readFile(devicesPath(), 'utf8');
      return parseRegistry(text);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { devices: {}, networks: {} };
      }
      throw err;
    }
  }

  async getDevice(name: string): Promise<Registry['devices'][string] | undefined> {
    const r = await this.read();
    return r.devices[name];
  }

  async getActive(): Promise<string | undefined> {
    return (await this.read()).active;
  }
}
