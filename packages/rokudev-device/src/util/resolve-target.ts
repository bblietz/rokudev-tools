import { RegistryReader, fail } from '@rokudev/device-client';

export type ResolvedTarget = { device?: string; host: string; dev_password?: string };
export type ResolveArgs = {
  device?: string;
  host?: string;
  device_ip?: string;
  dev_password?: string;
};

export async function resolveTarget(args: ResolveArgs): Promise<ResolvedTarget> {
  const tried: string[] = [];

  // Step 1: per-call host/password win unconditionally.
  const directHost = args.host ?? args.device_ip;
  if (directHost) {
    return {
      ...(args.device !== undefined ? { device: args.device } : {}),
      host: directHost,
      ...(args.dev_password ? { dev_password: args.dev_password } : {}),
    };
  }
  tried.push('per-call');

  const reader = new RegistryReader();
  const reg = await reader.read();

  // Determine the device name from args.device, or fall back to the active
  // registry device. Per-device env-vars apply to whichever name we end up with
  // (so the active device's env overrides still work; this is the §2.4 spec).
  const deviceName = args.device ?? reg.active;
  const entry = deviceName ? reg.devices[deviceName] : undefined;

  if (deviceName) {
    const envName = deviceName.replace(/-/g, '_').toUpperCase();
    const envHost = process.env[`ROKUDEV_HOST_${envName}`];
    const envPass = process.env[`ROKUDEV_DEV_PASSWORD_${envName}`];
    if (entry || envHost) {
      const host = envHost ?? entry?.host;
      if (!host) {
        tried.push('per-device-env', 'registry-entry');
        // fall through to global env / fail
      } else {
        const pw = envPass ?? entry?.dev_password;
        return { device: deviceName, host, ...(pw ? { dev_password: pw } : {}) };
      }
    }
    tried.push(args.device ? 'registry-device' : 'registry-active');
  }

  // Step 4: global env vars (ROKUDEV_DEFAULT_ROKU_HOST + ROKUDEV_ROKU_DEV_PASSWORD).
  const gHost = process.env['ROKUDEV_DEFAULT_ROKU_HOST'];
  const gPass = process.env['ROKUDEV_ROKU_DEV_PASSWORD'];
  if (gHost) {
    return { host: gHost, ...(gPass ? { dev_password: gPass } : {}) };
  }
  tried.push('global-env');

  throw fail('DEVICE_NOT_RESOLVED', 'no host/password resolved', { tried });
}
