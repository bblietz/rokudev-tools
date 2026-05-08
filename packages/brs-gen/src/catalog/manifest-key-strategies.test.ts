import { describe, it, expect } from 'vitest';
import { MANIFEST_KEY_STRATEGIES, getStrategy } from './manifest-key-strategies.js';

describe('manifest-key-strategies', () => {
  it('registers set keys', () => {
    for (const k of ['title', 'subtitle', 'splash_color', 'splash_min_time', 'ui_resolutions',
                     'major_version', 'minor_version', 'build_version']) {
      expect(MANIFEST_KEY_STRATEGIES[k]?.strategy).toBe('set');
    }
  });
  it('registers set-if-unset keys', () => {
    for (const k of ['mm_icon_focus_hd','mm_icon_focus_fhd','splash_screen_hd','splash_screen_fhd',
                     'splash_screen_uhd','splash_screen_shd','mm_icon_side_hd','mm_icon_side_fhd',
                     'requires_billing']) {
      expect(MANIFEST_KEY_STRATEGIES[k]?.strategy).toBe('set-if-unset');
    }
  });
  it('registers append-csv keys', () => {
    for (const k of ['bs_const', 'supports_input_launch']) {
      expect(MANIFEST_KEY_STRATEGIES[k]?.strategy).toBe('append-csv');
    }
  });
  it('getStrategy returns undefined for unknown', () => {
    expect(getStrategy('madeUpKey')).toBeUndefined();
  });
  it('version keys are template-only', () => {
    expect(MANIFEST_KEY_STRATEGIES.major_version?.templateOnly).toBe(true);
    expect(MANIFEST_KEY_STRATEGIES.minor_version?.templateOnly).toBe(true);
    expect(MANIFEST_KEY_STRATEGIES.build_version?.templateOnly).toBe(true);
  });
});
