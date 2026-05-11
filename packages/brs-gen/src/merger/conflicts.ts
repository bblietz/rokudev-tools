import { fail, type Failure } from '@rokudev/device-client';
import type { ModuleToml } from '../catalog/module-toml.js';

type R = { ok: true } | { ok: false; failure: Failure };

export function detectConflicts(modules: ModuleToml[], templateFilePaths: string[]): R {
  const present = new Set(modules.map((m) => m.module.id));
  for (const m of modules) {
    for (const other of m.module_conflicts.exclusive_with) {
      if (present.has(other)) {
        return {
          ok: false,
          failure: fail(
            'MODULE_CONFLICT',
            `module ${m.module.id} is exclusive_with ${other}, which is also present`,
            { stage: 'conflicts', a: m.module.id, b: other },
          ),
        };
      }
    }
  }
  // File-collision detection: every module file and every template file must be unique.
  const owners = new Map<string, string>();
  for (const p of templateFilePaths) owners.set(p, '<template>');
  for (const m of modules) {
    for (const p of m.module_files.add) {
      if (p.startsWith('source/_template/') || p.startsWith('assets/')) {
        return {
          ok: false,
          failure: fail(
            'FILE_COLLISION',
            `module ${m.module.id} cannot add path ${p}: source/_template/ and assets/ are reserved for template content`,
            {
              stage: 'conflicts',
              path: p,
              owner_a: '<template-reserved>',
              owner_b: m.module.id,
            },
          ),
        };
      }
      const existing = owners.get(p);
      if (existing !== undefined) {
        return {
          ok: false,
          failure: fail(
            'FILE_COLLISION',
            `path ${p} added by both ${existing} and module ${m.module.id}`,
            { stage: 'conflicts', path: p, owner_a: existing, owner_b: m.module.id },
          ),
        };
      }
      owners.set(p, `module:${m.module.id}`);
    }
  }
  return { ok: true };
}
