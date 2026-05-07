import { z } from 'zod';

export const NETWORK_TAG = z.enum(['home', 'corp', 'home_via_vpn', 'unknown']);
export type NetworkTag = z.infer<typeof NETWORK_TAG>;

export const DeviceNameSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/, 'device name must match [A-Za-z0-9_-]+');
export type DeviceName = z.infer<typeof DeviceNameSchema>;

export const DeviceEntrySchema = z.object({
  host: z.string().min(1),
  hostname: z.string().optional(),
  network_tag: NETWORK_TAG.optional(),
  serial: z.string().optional(),
  model: z.string().optional(),
  dev_password: z.string().optional(),
  added_at: z.string().optional(),
  last_seen: z.string().optional(),
});
export type DeviceEntry = z.infer<typeof DeviceEntrySchema>;

export const NetworkEntrySchema = z.object({
  gateway_mac: z.string().optional(),
  gateway_subnet_v4: z.string().optional(),
  dns_search_suffix: z.string().optional(),
  reachable_from: z.array(z.string()).optional(),
});
export type NetworkEntry = z.infer<typeof NetworkEntrySchema>;

export const RegistrySchema = z.object({
  active: z.string().optional(),
  devices: z.record(DeviceNameSchema, DeviceEntrySchema).default({}),
  networks: z.record(z.string(), NetworkEntrySchema).default({}),
});
export type Registry = z.infer<typeof RegistrySchema>;
