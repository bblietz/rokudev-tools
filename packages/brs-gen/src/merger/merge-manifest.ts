import { fail, type Failure } from '@rokudev/device-client';
import { getStrategy } from '../catalog/manifest-key-strategies.js';

type ModuleContrib = { id: string; manifest: Record<string, string> };
type R = { ok: true; manifest: Map<string, string> } | { ok: false; failure: Failure };

function mergeAppendCsv(existing: string | undefined, next: string): string {
  const set = new Set<string>();
  if (existing) existing.split(',').forEach((s) => set.add(s.trim()));
  next.split(',').forEach((s) => set.add(s.trim()));
  return [...set].sort().join(',');
}

export function mergeManifest(templateDefaults: Record<string, string>, modules: ModuleContrib[]): R {
  const out = new Map<string, string>();
  const keyOwners = new Map<string, string>(); // who last contributed each key
  for (const [k, v] of Object.entries(templateDefaults)) {
    out.set(k, v);
    keyOwners.set(k, '<template>');
  }

  for (const m of modules) {
    for (const [k, v] of Object.entries(m.manifest)) {
      const strat = getStrategy(k);
      if (!strat) {
        return { ok: false, failure: fail('UNKNOWN_MANIFEST_KEY',
          `module ${m.id} contributes manifest key ${k} which is not in the strategy table`,
          { stage: 'merge-manifest', module_id: m.id, key: k }) };
      }
      if (strat.templateOnly) {
        return { ok: false, failure: fail('MANIFEST_KEY_CONFLICT',
          `manifest key ${k} is template-only; module ${m.id} cannot contribute it`,
          { stage: 'merge-manifest', module_id: m.id, key: k }) };
      }
      const existing = out.get(k);
      if (strat.strategy === 'set') {
        if (existing !== undefined && existing !== v) {
          return { ok: false, failure: fail('MANIFEST_KEY_CONFLICT',
            `manifest key ${k} set by ${keyOwners.get(k)} to "${existing}"; module ${m.id} conflicts with "${v}"`,
            { stage: 'merge-manifest', key: k, existing, incoming: v,
              owner_a: keyOwners.get(k), owner_b: m.id }) };
        }
        out.set(k, v);
        if (existing === undefined) keyOwners.set(k, m.id);
      } else if (strat.strategy === 'set-if-unset') {
        if (existing !== undefined && existing !== v) {
          return { ok: false, failure: fail('MANIFEST_KEY_CONFLICT',
            `set-if-unset manifest key ${k} contested; ${keyOwners.get(k)} has "${existing}", module ${m.id} wants "${v}"`,
            { stage: 'merge-manifest', key: k, existing, incoming: v,
              owner_a: keyOwners.get(k), owner_b: m.id }) };
        }
        if (existing === undefined) { out.set(k, v); keyOwners.set(k, m.id); }
      } else if (strat.strategy === 'append-csv') {
        out.set(k, mergeAppendCsv(existing, v));
        keyOwners.set(k, existing === undefined ? m.id : `${keyOwners.get(k)},${m.id}`);
      }
      // Note: spec §7 specifies `requires_billing` uses `set-if-unset with
      // logical-or convergence` (true wins over conflicting false). Plan 3's
      // stub catalog contributes no manifest keys from modules, so this path
      // is never exercised. Plan 5's real modules (Pay, Ads) will need this
      // specialization; fold into the strategy switch when the first real
      // contributor lands, and add a regression test at that time.
    }
  }
  return { ok: true, manifest: out };
}
