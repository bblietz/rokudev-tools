import ejs from 'ejs';
import { detectConflicts } from './conflicts.js';
import { topoSortInitOrder } from './init-order.js';
import { validateWiring } from './wiring.js';
import { mergeManifest } from './merge-manifest.js';
import { emitModuleConfigBs } from './emit-config-bs.js';
import { emitInitHooks } from './emit-init-hooks.js';
import { buildProvenance } from './provenance.js';
import { sortByPath } from '../util/deterministic.js';
import { fail } from '@rokudev/device-client';
import type { TemplateToml } from '../catalog/template-toml.js';
import type { ModuleToml } from '../catalog/module-toml.js';
import type { AppSpecV2 } from '../spec/app-spec.js';

export type EmittedProject = {
  files: ReadonlyArray<{ path: string; content: Buffer | string }>;
  manifest: ReadonlyMap<string, string>;
  provenance: string;
  initOrder: string[];
};

type BuildInput = {
  spec: AppSpecV2;
  template: TemplateToml;
  modules: ModuleToml[];
  renderedTemplateFiles: ReadonlyArray<{ path: string; content: string | Buffer }>;
  moduleFileBytes: ReadonlyMap<string, Buffer>;
  brsGenVersion: string;
};

export async function buildEmittedProject(input: BuildInput): Promise<EmittedProject> {
  const templatePaths = input.renderedTemplateFiles.map((f) => f.path);
  const conf = detectConflicts(input.modules, templatePaths);
  if (!conf.ok) throw conf.failure;
  const topo = topoSortInitOrder(input.modules);
  if (!topo.ok) throw topo.failure;
  const wiring = validateWiring(input.template, input.modules);
  if (!wiring.ok) throw wiring.failure;

  // Manifest merge
  const specModuleConfigs = new Map(input.spec.modules.map((m) => [m.id, m.config ?? {}]));
  const moduleContribs = input.modules.map((m) => ({
    id: m.module.id,
    manifest: (m.module_manifest ?? {}) as Record<string, string>,
  }));
  // template_manifest_defaults may contain EJS placeholders (e.g. "<%= spec.app.name %>").
  // Render them against the spec before merging so the downstream Map holds finalized
  // manifest values, not raw template text.
  const renderedDefaults: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.template.template_manifest_defaults as Record<string, string>)) {
    try {
      renderedDefaults[k] = ejs.render(v, { spec: input.spec }, { async: false });
    } catch (e) {
      throw fail('APP_SPEC_INVALID',
        `failed to render EJS template for manifest key ${k}: ${e instanceof Error ? e.message : String(e)}`,
        { stage: 'build', key: k, raw_value: v });
    }
  }
  const manifestRes = mergeManifest(renderedDefaults, moduleContribs);
  if (!manifestRes.ok) throw manifestRes.failure;

  // config.bs per module
  const configFiles: Array<{ path: string; content: string }> = [];
  for (const m of input.modules) {
    const conf = specModuleConfigs.get(m.module.id) ?? {};
    configFiles.push({
      path: `source/_modules/${m.module.id}/config.bs`,
      content: emitModuleConfigBs(m.module.id, conf),
    });
  }

  // __init_hooks.bs
  const callsByModule = new Map(input.modules.map((m) => [m.module.id, m.module_wiring.init_calls]));
  const initHooksContent = emitInitHooks(
    input.template.template_exports.init_hooks,
    topo.order,
    callsByModule,
  );

  // Module static files copied verbatim
  const moduleFiles: Array<{ path: string; content: Buffer }> = [];
  for (const m of input.modules) {
    for (const p of m.module_files.add) {
      const b = input.moduleFileBytes.get(p);
      if (!b) {
        throw fail('CATALOG_INTEGRITY',
          `module ${m.module.id} declares file ${p} but no bytes were provided`,
          { stage: 'build', module_id: m.module.id, missing: p });
      }
      moduleFiles.push({ path: p, content: b });
    }
  }

  // Manifest file (sorted lines)
  const manifestLines = [...manifestRes.manifest.entries()].sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  const manifestFile = { path: 'manifest', content: manifestLines };

  // Provenance
  const provenance = buildProvenance({
    spec_version: input.spec.spec_version,
    template: { id: input.template.template.id, version: input.template.template.version },
    modules: input.modules.map((m) => ({
      id: m.module.id, version: m.module.version,
      files: [...m.module_files.add, `source/_modules/${m.module.id}/config.bs`],
    })),
    init_order: topo.order,
    manifest_keys: [...manifestRes.manifest.keys()],
    brs_gen_version: input.brsGenVersion,
  });
  const provenanceFile = { path: '.rokudev-tools/provenance.json', content: provenance };

  const all = [
    ...input.renderedTemplateFiles,
    ...moduleFiles,
    ...configFiles,
    { path: 'source/_modules/__init_hooks.bs', content: initHooksContent },
    manifestFile,
    provenanceFile,
  ];

  return {
    files: sortByPath(all),
    manifest: manifestRes.manifest,
    provenance,
    initOrder: topo.order,
  };
}
