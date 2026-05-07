export const STANDARD_KEYS = new Set([
  'Home','Rev','Fwd','Play','Select','Left','Right','Down','Up','Back',
  'InstantReplay','Info','Backspace','Search','Enter',
  'VolumeDown','VolumeUp','VolumeMute',
  'Power','PowerOff','ChannelUp','ChannelDown',
  'InputTuner','InputHDMI1','InputHDMI2','InputHDMI3','InputHDMI4','InputAV1',
  'FindRemote',
] as const);

const LIT_DISALLOWED_CHARS = new Set(['/', '?', '#', '%', '&', '+', '\\', ' ']);

export function isAllowedKey(key: string): boolean {
  if (STANDARD_KEYS.has(key as never)) return true;
  if (!key.startsWith('Lit_')) return false;
  const ch = key.slice(4);
  if (ch.length !== 1) return false;
  const code = ch.charCodeAt(0);
  if (code < 0x20 || code > 0x7e) return false;
  if (LIT_DISALLOWED_CHARS.has(ch)) return false;
  return true;
}
