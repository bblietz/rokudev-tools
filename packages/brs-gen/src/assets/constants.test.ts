import { describe, it, expect } from 'vitest';
import {
  ICON_BUCKETS,
  SPLASH_BUCKETS,
  ICON_SOURCE_MIN,
  SPLASH_SOURCE_MIN,
} from './constants.js';

describe('asset bucket matrix', () => {
  it('icon buckets are hd=290x218 and fhd=336x210', () => {
    expect(ICON_BUCKETS).toEqual([
      { bucket: 'hd', width: 290, height: 218, manifestKey: 'mm_icon_focus_hd' },
      { bucket: 'fhd', width: 336, height: 210, manifestKey: 'mm_icon_focus_fhd' },
    ]);
  });

  it('splash buckets are hd=1280x720, fhd=1920x1080, uhd=3840x2160', () => {
    expect(SPLASH_BUCKETS).toEqual([
      { bucket: 'hd', width: 1280, height: 720, manifestKey: 'splash_screen_hd' },
      { bucket: 'fhd', width: 1920, height: 1080, manifestKey: 'splash_screen_fhd' },
      { bucket: 'uhd', width: 3840, height: 2160, manifestKey: 'splash_screen_uhd' },
    ]);
  });

  it('source mins are min-of-all-bucket-dimensions', () => {
    // Icon: largest width (336) x largest height (218).
    expect(ICON_SOURCE_MIN).toEqual({ min_width: 336, min_height: 218 });
    // Splash: uhd (3840 x 2160).
    expect(SPLASH_SOURCE_MIN).toEqual({ min_width: 3840, min_height: 2160 });
  });
});
