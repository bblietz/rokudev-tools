import {
  readFingerprint,
  classifyNetwork,
  isReachable,
  RegistryReader,
  fail,
  type NetworkTag,
} from '@rokudev/device-client';

interface CacheEntry {
  ts: number;
  tag: NetworkTag;
}

let cached: CacheEntry | undefined;
const CACHE_MS = 30_000;

/**
 * Guard: if the targeted device has a registered network_tag, fingerprint the
 * current host network and throw NETWORK_UNREACHABLE when the device cannot be
 * reached from here (per spec §4.2).
 *
 * @param deviceName - the registry device name, or undefined (then no check).
 * @param force      - when true, bypass the guard unconditionally.
 */
export async function checkReachable(
  deviceName: string | undefined,
  force: boolean,
): Promise<void> {
  if (force || !deviceName) return;

  const reg = await new RegistryReader().read();
  const entry = reg.devices[deviceName];
  if (!entry?.network_tag) return; // no tag, no policy

  const now = Date.now();
  if (!cached || now - cached.ts > CACHE_MS) {
    const fp = await readFingerprint();
    cached = { ts: now, tag: classifyNetwork(fp, reg.networks) };
  }

  if (!isReachable(cached.tag, entry.network_tag, reg.networks)) {
    throw fail(
      'NETWORK_UNREACHABLE',
      `device '${deviceName}' is on ${entry.network_tag}; you appear to be on ${cached.tag}`,
      { device_network: entry.network_tag, current_network: cached.tag },
    );
  }
}

/** Reset the classification cache. Intended for use in tests only. */
export function _resetCache(): void {
  cached = undefined;
}
