import { writeFile, rename, mkdir, readFile } from 'node:fs/promises';
import * as lockfile from 'proper-lockfile';
import { devicesPath, devicesLockPath, configDir } from './paths.js';
import { parseRegistry, serializeRegistry } from './parse.js';
import {
  RegistrySchema,
  DeviceEntrySchema,
  DeviceNameSchema,
  type Registry,
  type DeviceEntry,
} from './types.js';
import { fail } from '../errors/index.js';

const LOCK_OPTS = { retries: { retries: 50, minTimeout: 50, maxTimeout: 200 }, stale: 10_000 };

export class RegistryWriter {
  /**
   * Atomically apply `mutate` to the registry under an advisory lock.
   * Throws REGISTRY_BUSY (Failure) if the lock cannot be acquired in 5s.
   */
  async transact<T>(mutate: (r: Registry) => T): Promise<T> {
    await mkdir(configDir(), { recursive: true, mode: 0o700 });
    // Touch the lockfile so proper-lockfile can lock it.
    try {
      await writeFile(devicesLockPath(), '', { flag: 'wx', mode: 0o600 });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    let release: (() => Promise<void>) | undefined;
    try {
      release = await lockfile.lock(devicesLockPath(), LOCK_OPTS);
    } catch {
      throw fail('REGISTRY_BUSY', 'could not acquire registry lock within 5s');
    }
    try {
      let current: Registry;
      try {
        const text = await readFile(devicesPath(), 'utf8');
        current = parseRegistry(text);
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          current = { devices: {}, networks: {} };
        } else { throw err; }
      }
      const result = mutate(current);
      const validated = RegistrySchema.parse(current);
      const tmp = `${devicesPath()}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 10)}`;
      const text = serializeRegistry(validated);
      // writeFile creates tmp at 0o600; rename preserves mode on POSIX.
      await writeFile(tmp, text, { mode: 0o600 });
      await rename(tmp, devicesPath());
      return result;
    } finally {
      if (release) await release();
    }
  }

  /**
   * Insert or upsert a device. If a device with this name already exists, the
   * provided fields are merged on top of the existing entry (existing fields
   * not in `entry` are preserved).
   */
  async addDevice(name: string, entry: DeviceEntry): Promise<void> {
    const safeName = DeviceNameSchema.safeParse(name);
    if (!safeName.success) {
      throw fail('INVALID_DEVICE_NAME', `device name "${name}" must match [A-Za-z0-9_-]+`);
    }
    const safeEntry = DeviceEntrySchema.parse(entry);
    await this.transact((r) => { r.devices[name] = { ...r.devices[name], ...safeEntry }; });
  }

  async setPassword(name: string, password: string): Promise<void> {
    await this.transact((r) => {
      const existing = r.devices[name];
      if (!existing) throw fail('DEVICE_NOT_FOUND', `no device "${name}" in registry`);
      r.devices[name] = { ...existing, dev_password: password };
    });
  }

  async setActive(name: string): Promise<void> {
    await this.transact((r) => {
      if (!r.devices[name]) throw fail('DEVICE_NOT_FOUND', `no device "${name}" in registry`);
      r.active = name;
    });
  }

  /**
   * Remove a device. Idempotent: calling on a non-existent device is a no-op
   * (no error). If the removed device was the active device, `active` is also
   * cleared.
   */
  async removeDevice(name: string): Promise<void> {
    await this.transact((r) => {
      delete r.devices[name];
      if (r.active === name) delete r.active;
    });
  }
}
