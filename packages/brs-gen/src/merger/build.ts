import ejs from 'ejs';
import { detectConflicts } from './conflicts.js';
import { topoSortInitOrder } from './init-order.js';
import { validateWiring } from './wiring.js';
import { mergeManifest } from './merge-manifest.js';
import { emitModuleConfigBs } from './emit-config-bs.js';
import { emitInitHooks } from './emit-init-hooks.js';
import { buildProvenance } from './provenance.js';
import { sortByPath } from '../util/deterministic.js';
import { moduleIdToBsId } from '../util/module-id.js';
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
  /** Asset files to copy verbatim into the project (e.g. icon PNGs). */
  assetBuckets?: ReadonlyMap<string, Buffer>;
  /** Manifest key/value pairs from asset resolution. Applied set-if-unset:
   *  template_manifest_defaults entries take priority. */
  assetManifestEntries?: Readonly<Record<string, string>>;
  /** Pre-rendered BrightScript for source/_template/config.brs.
   *  Omitted from output when undefined. */
  templateConfigBrs?: string;
};

/**
 * Pattern matching a `<script>` tag whose `uri` references `__init_hooks.bs`
 * or `__init_hooks.brs` (case-sensitive). The strict `(bs|brs)` alternation
 * prevents false-positive matches on similarly-named files such as
 * `__init_hooks.br` or `__init_hooks.bss`.
 *
 * Exported for direct testing.
 */
export const INIT_HOOKS_SCRIPT_PATTERN =
  /(<script[^>]*uri=["'][^"']*__init_hooks\.(?:bs|brs)["'][^>]*\/>)/;

/**
 * If the given XML body contains a `<script>` tag referencing `__init_hooks`,
 * append `<script>` tags for each path in `modulePaths` immediately after it.
 * The paths are emitted as `pkg:/<path>` URIs. When the XML does not include
 * `__init_hooks` or `modulePaths` is empty, the input string is returned
 * unchanged.
 *
 * Exported for direct testing.
 */
export function injectModuleScriptsIntoXml(
  xmlBody: string,
  modulePaths: ReadonlyArray<string>,
): string {
  if (modulePaths.length === 0) return xmlBody;
  if (!INIT_HOOKS_SCRIPT_PATTERN.test(xmlBody)) return xmlBody;
  const tags = modulePaths
    .map((p) => `  <script type="text/brightscript" uri="pkg:/${p}" />`)
    .join('\n');
  return xmlBody.replace(INIT_HOOKS_SCRIPT_PATTERN, `$1\n${tags}`);
}

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
  for (const [k, v] of Object.entries(
    input.template.template_manifest_defaults as Record<string, string>,
  )) {
    try {
      renderedDefaults[k] = ejs.render(v, { spec: input.spec }, { async: false });
    } catch (e) {
      throw fail(
        'APP_SPEC_INVALID',
        `failed to render EJS template for manifest key ${k}: ${e instanceof Error ? e.message : String(e)}`,
        { stage: 'build', key: k, raw_value: v },
      );
    }
  }
  if (input.assetManifestEntries) {
    for (const [k, v] of Object.entries(input.assetManifestEntries)) {
      if (!(k in renderedDefaults)) {
        renderedDefaults[k] = v;
      }
    }
  }
  const manifestRes = mergeManifest(renderedDefaults, moduleContribs);
  if (!manifestRes.ok) throw manifestRes.failure;

  // config.bs per module
  // Dotted-namespace module ids (e.g. analytics.event_pipe) normalize to
  // BrightScript-safe identifiers via moduleIdToBsId for filesystem paths.
  const configFiles: Array<{ path: string; content: string }> = [];
  for (const m of input.modules) {
    const conf = specModuleConfigs.get(m.module.id) ?? {};
    const bsId = moduleIdToBsId(m.module.id);
    configFiles.push({
      path: `source/_modules/${bsId}/config.bs`,
      content: emitModuleConfigBs(m.module.id, conf),
    });
  }

  // __init_hooks.bs
  const callsByModule = new Map(
    input.modules.map((m) => [m.module.id, m.module_wiring.init_calls]),
  );
  const initHooksContent = emitInitHooks(
    input.template.template_exports.init_hooks,
    topo.order,
    callsByModule,
    wiring.matchedOptional,
  );

  // Module static files copied verbatim
  const moduleFiles: Array<{ path: string; content: Buffer }> = [];
  for (const m of input.modules) {
    for (const p of m.module_files.add) {
      const b = input.moduleFileBytes.get(p);
      if (!b) {
        throw fail(
          'CATALOG_INTEGRITY',
          `module ${m.module.id} declares file ${p} but no bytes were provided`,
          { stage: 'build', module_id: m.module.id, missing: p },
        );
      }
      moduleFiles.push({ path: p, content: b });
    }
  }

  const assetFiles: Array<{ path: string; content: Buffer }> = [];
  if (input.assetBuckets) {
    for (const [p, b] of input.assetBuckets) {
      assetFiles.push({ path: p, content: b });
    }
  }

  const templateConfigFiles: Array<{ path: string; content: string }> = [];
  if (input.templateConfigBrs !== undefined) {
    templateConfigFiles.push({
      path: 'source/_template/config.bs',
      content: input.templateConfigBrs,
    });
  }

  // Manifest file (sorted lines)
  const manifestLines =
    [...manifestRes.manifest.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') + '\n';
  const manifestFile = { path: 'manifest', content: manifestLines };

  // Provenance
  const provenance = buildProvenance({
    spec_version: input.spec.spec_version,
    template: { id: input.template.template.id, version: input.template.template.version },
    modules: input.modules.map((m) => ({
      id: m.module.id,
      version: m.module.version,
      files: [...m.module_files.add, `source/_modules/${moduleIdToBsId(m.module.id)}/config.bs`],
    })),
    init_order: topo.order,
    manifest_keys: [...manifestRes.manifest.keys()],
    brs_gen_version: input.brsGenVersion,
  });
  const provenanceFile = { path: '.rokudev-tools/provenance.json', content: provenance };

  // Collect all .bs source paths contributed by modules so that XML components
  // which include __init_hooks.bs can also list them as <script> tags. This is
  // necessary because bsc validates each <script>-included .bs file in the
  // component scope, where only explicitly-listed scripts are visible. Without
  // this injection, any call from __init_hooks.bs to a module-provided function
  // (e.g. from optional_init_calls) produces bsc error 1140.
  const moduleSourceBsPaths: string[] = [];
  for (const m of input.modules) {
    for (const p of m.module_files.add) {
      if (p.startsWith('source/') && (p.endsWith('.bs') || p.endsWith('.brs'))) {
        moduleSourceBsPaths.push(p);
      }
    }
    // Also include the auto-generated config.bs for this module.
    const bsId = moduleIdToBsId(m.module.id);
    moduleSourceBsPaths.push(`source/_modules/${bsId}/config.bs`);
  }

  // Patch XML template files: inject <script> tags for module source files and
  // the auto-generated config.bs files into any component that already lists
  // __init_hooks.bs as a script. Skip when there are no module source paths so
  // no-module compositions produce byte-identical XML to the pre-engine-fix
  // baseline (preserving existing snapshot and golden tests).
  const patchedTemplateFiles = input.renderedTemplateFiles.map((f) => {
    if (!f.path.endsWith('.xml')) return f;
    if (moduleSourceBsPaths.length === 0) return f;
    const src = typeof f.content === 'string' ? f.content : f.content.toString('utf8');
    const patched = injectModuleScriptsIntoXml(src, moduleSourceBsPaths);
    if (patched === src) return f;
    return { path: f.path, content: patched };
  });

  const all = [
    ...patchedTemplateFiles,
    ...moduleFiles,
    ...assetFiles,
    ...configFiles,
    ...templateConfigFiles,
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
