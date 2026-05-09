export type ManifestStrategy = 'set' | 'set-if-unset' | 'append-csv';
export type ManifestKeyEntry = { strategy: ManifestStrategy; templateOnly?: boolean };

export const MANIFEST_KEY_STRATEGIES: Readonly<Record<string, ManifestKeyEntry>> = Object.freeze({
  title: { strategy: 'set' },
  subtitle: { strategy: 'set' },
  splash_color: { strategy: 'set' },
  splash_min_time: { strategy: 'set' },
  ui_resolutions: { strategy: 'set' },
  major_version: { strategy: 'set', templateOnly: true },
  minor_version: { strategy: 'set', templateOnly: true },
  build_version: { strategy: 'set', templateOnly: true },
  mm_icon_focus_hd: { strategy: 'set-if-unset' },
  mm_icon_focus_fhd: { strategy: 'set-if-unset' },
  splash_screen_hd: { strategy: 'set-if-unset' },
  splash_screen_fhd: { strategy: 'set-if-unset' },
  splash_screen_uhd: { strategy: 'set-if-unset' },
  splash_screen_shd: { strategy: 'set-if-unset' },
  mm_icon_side_hd: { strategy: 'set-if-unset' },
  mm_icon_side_fhd: { strategy: 'set-if-unset' },
  requires_billing: { strategy: 'set-if-unset' },
  bs_const: { strategy: 'append-csv' },
  supports_input_launch: { strategy: 'append-csv' },
});

export function getStrategy(key: string): ManifestKeyEntry | undefined {
  return MANIFEST_KEY_STRATEGIES[key];
}
