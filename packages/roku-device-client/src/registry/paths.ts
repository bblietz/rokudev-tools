import { homedir } from 'node:os';
import { join } from 'node:path';

export function configDir(): string {
  return process.env['ROKUDEV_CONFIG_DIR'] ?? join(homedir(), '.config', 'rokudev');
}
export function devicesPath(): string {
  return join(configDir(), 'devices.toml');
}
export function devicesLockPath(): string {
  return join(configDir(), 'devices.toml.lock');
}
export function configPath(): string {
  return join(configDir(), 'config.toml');
}
