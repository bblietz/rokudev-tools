const ECP_INPUT_KEYS = new Set([
  'accelerator',
  'mediaType',
  'contentId',
  'contentLabel',
  'playbackPosition',
  'streamFormat',
  // Roku Deep Link Test Tool standard keys (channel reads via event.GetData):
  'action',
  'source',
  'state',
] as const);
const ECP_LAUNCH_KEYS = new Set([
  'contentId',
  'mediaType',
  // Brightscript Debug Protocol enable: required to open BDP control port 8081.
  // Without this query param the device leaves the BDP listener closed even
  // when a dev channel is running. Verified on firmware 15.2.4 / BDP v3.5.0
  // (see docs/refs/bdp-wire-format.md §6 Run 1).
  'bs_debug_protocol',
  // Debugger console port override (paired with bs_debug_protocol).
  'RMPDevPort',
] as const);
const X_KEY = /^x_[A-Za-z0-9_]+$/;

export function isAllowedInputParamKey(k: string): boolean {
  return ECP_INPUT_KEYS.has(k as never) || X_KEY.test(k);
}
export function isAllowedLaunchParamKey(k: string): boolean {
  return ECP_LAUNCH_KEYS.has(k as never) || X_KEY.test(k);
}
