export type Bucket = {
  bucket: 'hd' | 'fhd' | 'uhd';
  width: number;
  height: number;
  manifestKey: string;
};

// Roku does not define a separate UHD icon bucket.
export const ICON_BUCKETS: readonly Bucket[] = Object.freeze([
  { bucket: 'hd', width: 290, height: 218, manifestKey: 'mm_icon_focus_hd' },
  { bucket: 'fhd', width: 336, height: 210, manifestKey: 'mm_icon_focus_fhd' },
] as const);

export const SPLASH_BUCKETS: readonly Bucket[] = Object.freeze([
  { bucket: 'hd', width: 1280, height: 720, manifestKey: 'splash_screen_hd' },
  { bucket: 'fhd', width: 1920, height: 1080, manifestKey: 'splash_screen_fhd' },
  { bucket: 'uhd', width: 3840, height: 2160, manifestKey: 'splash_screen_uhd' },
] as const);

// Source-min = min of all bucket dimensions (so every bucket downscales, none upscales).
export const ICON_SOURCE_MIN = { min_width: 336, min_height: 218 } as const;
export const SPLASH_SOURCE_MIN = { min_width: 3840, min_height: 2160 } as const;
