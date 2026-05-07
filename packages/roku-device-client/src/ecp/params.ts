const ECP_INPUT_KEYS = new Set([
  'accelerator',
  'mediaType',
  'contentId',
  'contentLabel',
  'playbackPosition',
  'streamFormat',
] as const);
const ECP_LAUNCH_KEYS = new Set(['contentId', 'mediaType'] as const);
const X_KEY = /^x_[A-Za-z0-9_]+$/;

export function isAllowedInputParamKey(k: string): boolean {
  return ECP_INPUT_KEYS.has(k as never) || X_KEY.test(k);
}
export function isAllowedLaunchParamKey(k: string): boolean {
  return ECP_LAUNCH_KEYS.has(k as never) || X_KEY.test(k);
}
