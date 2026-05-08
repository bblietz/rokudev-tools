import { fail, type Failure } from '@rokudev/device-client';
import type { TemplateToml } from '../catalog/template-toml.js';
import type { ModuleToml } from '../catalog/module-toml.js';

type R = { ok: true } | { ok: false; failure: Failure };

function hookKey(scope: string, phase: string): string { return `${scope}.${phase}`; }

export function validateWiring(template: TemplateToml, modules: ModuleToml[]): R {
  const templateId = template.template.id;
  const exportedHooks = new Set(template.template_exports.init_hooks.map((h) => hookKey(h.scope, h.phase)));
  const exportedNodes = new Set(template.template_exports.scene_nodes.map((n) => n.name));

  for (const m of modules) {
    for (const req of m.module_wiring.requires) {
      if (req.kind === 'init_hook') {
        if (!exportedHooks.has(hookKey(req.scope, req.phase))) {
          return { ok: false, failure: fail('WIRING_CONTRACT_VIOLATION',
            `module ${m.module.id} requires init_hook ${hookKey(req.scope, req.phase)} not exported by template ${templateId}`,
            { stage: 'wiring', module_id: m.module.id, missing: 'init_hook',
              requested: { scope: req.scope, phase: req.phase } }) };
        }
      } else if (req.kind === 'scene_node') {
        if (!exportedNodes.has(req.name)) {
          return { ok: false, failure: fail('WIRING_CONTRACT_VIOLATION',
            `module ${m.module.id} requires scene_node ${req.name} not exported by template ${templateId}`,
            { stage: 'wiring', module_id: m.module.id, missing: 'scene_node', requested: { name: req.name } }) };
        }
      } else {
        // Exhaustiveness guard: if a new RequireEntry.kind is added in module-toml.ts
        // without a branch here, TypeScript will flag this line at compile time.
        const _exhaustive: never = req;
        void _exhaustive;
      }
    }
    for (const call of m.module_wiring.init_calls) {
      if (!exportedHooks.has(call.hook)) {
        return { ok: false, failure: fail('WIRING_CONTRACT_VIOLATION',
          `module ${m.module.id} has init_call for hook ${call.hook} not exported by template ${templateId}`,
          { stage: 'wiring', module_id: m.module.id, missing: 'init_hook', requested: { hook: call.hook } }) };
      }
    }
  }
  return { ok: true };
}
