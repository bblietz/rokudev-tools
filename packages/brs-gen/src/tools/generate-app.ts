import { readFile, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import semver from 'semver';
import { fail, DevPortal } from '@rokudev/device-client';
import { resolveAssetSource } from '../assets/resolve-with-default.js';
import { bucketAsset, manifestEntriesForBuckets } from '../assets/pipeline.js';
import { ICON_SOURCE_MIN, SPLASH_SOURCE_MIN } from '../assets/constants.js';
import { emitTemplateConfigBs } from '../merger/emit-template-config.js';
import { registerToolsModule } from './_register.js';
import { getCatalog } from './_catalog-singleton.js';
import { AppSpecV2Wrapper } from '../spec/app-spec.js';
import { promoteV1ToV2 } from '../spec/promote.js';
import { preflightTemplate } from '../spec/preflight.js';
import { checkSpecCompat } from '../merger/compat.js';
import { validateModuleConfig } from '../merger/validate-config.js';
import { buildEmittedProject } from '../merger/build.js';
import { renderTemplateFiles } from '../render/ejs.js';
import { writeProject } from '../build/write.js';
import { compileProject } from '../build/compile.js';
import { packageProject } from '../build/zip.js';
import type { ModuleToml } from '../catalog/module-toml.js';
import { findPkgRoot, importTemplateSchema, readPkgVersion } from '../util/paths.js';

const pkgRoot = await findPkgRoot(import.meta.url);
const PKG_VERSION = await readPkgVersion(pkgRoot);

/**
 * Resolve the `spec` argument. Returns both the parsed object AND
 * `specOrigin`: the absolute path of the spec file if the input was a
 * filesystem path, or null for inline (object / JSON string) specs.
 * `specOrigin` is load-bearing for resolving relative asset paths
 * (branding.icon / branding.splash) — see src/assets/resolve.ts.
 */
// Return type spec is `any` to match the original IIFE which yielded the
// untyped result of `JSON.parse`. Downstream promoteV1ToV2 accepts
// `AppSpecV1 | AppSpecV2`; Zod wrapper parse is the real type guard.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveSpecInput(raw: unknown): Promise<{ spec: any; specOrigin: string | null }> {
  if (typeof raw !== 'string') return { spec: raw, specOrigin: null };
  // Strip BOM before the inline-JSON sniff; trim leading/trailing whitespace
  // so '  { ... }\n' still classifies as inline.
  const stripped = raw.replace(/^\uFEFF/, '').trim();
  if (stripped.startsWith('{')) {
    try {
      return { spec: JSON.parse(stripped), specOrigin: null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw fail('APP_SPEC_INVALID', `spec is not valid JSON: ${msg}`, {
        given: stripped.slice(0, 200),
      });
    }
  }
  // Treat as filesystem path.
  const absPath = isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
  let contents: string;
  try {
    contents = await readFile(absPath, 'utf8');
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e && e.code === 'ENOENT') {
      throw fail('APP_SPEC_INVALID', `spec file not found: ${raw}`, { given: raw });
    }
    const msg = e?.message ?? String(err);
    throw fail('APP_SPEC_INVALID', `failed to read spec file: ${raw}: ${msg}`, { given: raw });
  }
  try {
    return { spec: JSON.parse(contents), specOrigin: absPath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw fail('APP_SPEC_INVALID', `spec file contains invalid JSON: ${raw}: ${msg}`, {
      given_path: raw,
    });
  }
}

/**
 * Count files on disk under `dir`, excluding any entries whose relative path
 * matches (or is nested under) one of `excludePrefixes`. Used to report the
 * final `files_written` count that matches what the zip archives: post-compile
 * tree minus the `.rokudev-tools/{staging,sourcemaps}` trees.
 */
async function countFilesOnDisk(
  dir: string,
  excludePrefixes: ReadonlyArray<string>,
): Promise<number> {
  let count = 0;
  async function walk(sub: string, relPrefix: string): Promise<void> {
    for (const ent of await readdir(sub, { withFileTypes: true })) {
      const rel = relPrefix ? `${relPrefix}/${ent.name}` : ent.name;
      if (excludePrefixes.some((p) => rel === p || rel.startsWith(`${p}/`))) continue;
      if (ent.isDirectory()) await walk(join(sub, ent.name), rel);
      else if (ent.isFile()) count++;
    }
  }
  await walk(dir, '');
  return count;
}

// Recursive directory walker. Returns entries whose `path` is relative to
// `dir` using forward slashes so downstream callers (EJS renderer, merger)
// see the same path string on every OS.
async function readTemplateFiles(dir: string): Promise<Array<{ path: string; bytes: Buffer }>> {
  const out: Array<{ path: string; bytes: Buffer }> = [];
  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const e of entries) {
      const full = join(current, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile()) {
        const rel = relative(dir, full).split(/[\\/]/).join('/');
        const bytes = await readFile(full);
        out.push({ path: rel, bytes });
      }
    }
  }
  await walk(dir);
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}

// Reads every file a module declares in `module_files.add` and returns a
// flat Map<relativePath, Buffer>. `buildEmittedProject` expects the flat
// shape keyed by the same relative path the module declared.
async function readModuleFileBytes(
  pkgRootPath: string,
  modules: ReadonlyArray<ModuleToml>,
): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  for (const m of modules) {
    for (const rel of m.module_files.add) {
      const onDisk = join(pkgRootPath, 'modules', m.module.id, 'files', rel);
      const bytes = await readFile(onDisk);
      out.set(rel, bytes);
    }
  }
  return out;
}

registerToolsModule((tools) => {
  tools.set('generate_app', {
    name: 'generate_app',
    description:
      'Render a Roku channel project from a validated AppSpec: merges the template with ' +
      'feature modules, writes the project tree, runs a bsc compile, and optionally zips ' +
      'and sideloads. Deterministic (Path A); freeform LLM path (spec.freeform) is rejected ' +
      'as NOT_IMPLEMENTED in Plan 3.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['spec', 'output_dir'],
      properties: {
        spec: { type: ['string', 'object'] },
        output_dir: { type: 'string', minLength: 1 },
        overwrite: { type: 'boolean' },
        zip: { type: ['boolean', 'object', 'null'] },
        sideload: {
          type: 'object',
          additionalProperties: false,
          required: ['device', 'dev_password'],
          properties: {
            device: { type: 'string', minLength: 1 },
            dev_password: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    handler: async (args) => {
      const warnings: Array<{ code: string; message: string }> = [];

      // 1. Parse input: object passthrough, inline JSON (leading '{', BOM/ws
      //    tolerated), or filesystem path. All IO / parse failures are wrapped
      //    in APP_SPEC_INVALID by resolveSpecInput.
      const { spec: specInput, specOrigin } = await resolveSpecInput(args['spec']);

      // 1a. Reject freeform specs explicitly (Plan 6 lands this path).
      if (specInput && typeof specInput === 'object' && 'freeform' in specInput) {
        throw fail(
          'NOT_IMPLEMENTED',
          'spec.freeform is not supported in Plan 3; use the deterministic template+modules path',
          { field: 'spec.freeform' },
        );
      }

      // 2. v1 -> v2 auto-promotion (captures SPEC_AUTO_PROMOTED warning when applicable)
      const promoted = promoteV1ToV2(specInput);
      if (promoted.warning) warnings.push(promoted.warning);
      const spec = promoted.spec;

      // 3. Preflight template id against the catalog.
      const cat = getCatalog();
      const pf = preflightTemplate(spec.template, new Set(cat.templates.keys()));
      if (!pf.ok) throw pf.failure;

      // 4. Wrapper parse (passthrough; template-strict parse at 4a).
      const parsed = AppSpecV2Wrapper.safeParse(spec);
      if (!parsed.success) {
        throw fail('APP_SPEC_INVALID', 'AppSpec failed wrapper validation', {
          issues: parsed.error.issues,
        });
      }
      const appSpec = parsed.data;

      // 4a. Template-strict schema parse. Each template ships a schema.ts
      //     (source tree) or schema.js (compiled) exporting a strict `Schema`.
      //     Resolved through pkgRoot so dist/ and src/ both work.
      const templateMod = await importTemplateSchema(pkgRoot, spec.template);
      if (templateMod?.Schema) {
        const schemaMod = templateMod.Schema as {
          safeParse: (x: unknown) => { success: boolean; error?: { issues: unknown } };
        };
        const strict = schemaMod.safeParse(spec);
        if (!strict.success) {
          throw fail(
            'APP_SPEC_INVALID',
            `AppSpec failed strict validation against template '${spec.template}'`,
            { template_id: spec.template, issues: strict.error?.issues },
          );
        }
      }

      // 5. Resolve modules with version_range; emit MODULE_VERSION_UNPINNED as needed.
      const modules: ModuleToml[] = [];
      for (const ref of appSpec.modules) {
        const m = cat.modules.get(ref.id);
        if (!m) {
          throw fail('UNKNOWN_MODULE', `module not in catalog: ${ref.id}`, {
            stage: 'catalog',
            given: ref.id,
            known: [...cat.modules.keys()].sort(),
          });
        }
        if (ref.version_range === undefined) {
          warnings.push({
            code: 'MODULE_VERSION_UNPINNED',
            message: `module ${ref.id} reference omits version_range; using installed ${m.module.version}`,
          });
        } else if (!semver.satisfies(m.module.version, ref.version_range)) {
          throw fail(
            'MODULE_VERSION_UNAVAILABLE',
            `no installed version of ${ref.id} satisfies ${ref.version_range}`,
            {
              stage: 'catalog',
              module_id: ref.id,
              requested: ref.version_range,
              installed: m.module.version,
            },
          );
        }
        modules.push(m);
      }

      // 6. spec_compat check on template and every module.
      const tmpl = cat.templates.get(appSpec.template);
      if (!tmpl) {
        // Unreachable given preflight above, but satisfies the type narrow.
        throw fail('UNKNOWN_TEMPLATE', `template disappeared from catalog: ${appSpec.template}`, {
          stage: 'catalog',
          given: appSpec.template,
        });
      }
      const tc = checkSpecCompat(
        appSpec.spec_version,
        tmpl.template.spec_compat,
        `template:${tmpl.template.id}`,
      );
      if (!tc.ok) throw tc.failure;
      for (const m of modules) {
        const mc = checkSpecCompat(
          appSpec.spec_version,
          m.module.spec_compat,
          `module:${m.module.id}`,
        );
        if (!mc.ok) throw mc.failure;
      }

      // 7. Per-module config validation (ajv).
      for (const ref of appSpec.modules) {
        const m = cat.modules.get(ref.id);
        if (!m) continue; // already thrown above; narrows the type for TS
        const cr = validateModuleConfig(ref.id, m.module_config_schema, ref.config ?? {});
        if (!cr.ok) throw cr.failure;
      }

      // 7a-7l. Asset resolution via precedence: operator > template-static
      //        > synthesized. Effective primary_color = spec > template >
      //        "#000000". Synthesized PNGs are returned as in-memory Buffers
      //        by resolveAssetSource (no scratch dir needed; spec §6.4
      //        implicitly satisfied).
      const templateRoot = join(pkgRoot, 'templates', tmpl.template.id);
      const brandingSpec =
        (appSpec as { branding?: { icon?: string; splash?: string; primary_color?: string } })
          .branding ?? {};
      const brandingDefaults =
        (
          tmpl as {
            template_branding_defaults?: { icon?: string; splash?: string; primary_color?: string };
          }
        ).template_branding_defaults ?? {};
      const effectivePrimaryColor = brandingSpec.primary_color ?? brandingDefaults.primary_color;

      let assetBuckets: Map<string, Buffer> | undefined;
      let assetManifestEntries: Record<string, string> | undefined;

      const iconResolved = await resolveAssetSource({
        specAssetPath: brandingSpec.icon,
        specOrigin,
        templateRoot,
        templateDefaultPath: brandingDefaults.icon,
        effectivePrimaryColor,
        kind: 'icon',
        sourceMin: ICON_SOURCE_MIN,
      });
      const splashResolved = await resolveAssetSource({
        specAssetPath: brandingSpec.splash,
        specOrigin,
        templateRoot,
        templateDefaultPath: brandingDefaults.splash,
        effectivePrimaryColor,
        kind: 'splash',
        sourceMin: SPLASH_SOURCE_MIN,
      });

      const buckets = new Map<string, Buffer>();
      const entries: Record<string, string> = {};
      if (iconResolved.source !== 'none') {
        const iconBuckets = await bucketAsset(iconResolved.bytes, 'icon', 'images/icon');
        for (const [k, v] of iconBuckets) buckets.set(k, v);
        Object.assign(entries, manifestEntriesForBuckets('icon', 'images/icon'));
      }
      if (splashResolved.source !== 'none') {
        const splashBuckets = await bucketAsset(splashResolved.bytes, 'splash', 'images/splash');
        for (const [k, v] of splashBuckets) buckets.set(k, v);
        Object.assign(entries, manifestEntriesForBuckets('splash', 'images/splash'));
      }
      if (buckets.size > 0) {
        assetBuckets = buckets;
        assetManifestEntries = entries;
      }

      // 8. Load template + module file bytes from the bundled dirs.
      const templateFiles = await readTemplateFiles(
        join(pkgRoot, 'templates', tmpl.template.id, 'files'),
      );
      const moduleFileBytes = await readModuleFileBytes(pkgRoot, modules);

      // 9. Render template files (EJS).
      const renderedTemplateFiles = await renderTemplateFiles(templateFiles, appSpec, {
        brs_gen_version: PKG_VERSION,
        template_version: tmpl.template.version,
      });

      // 9a. NEW: emit TemplateConfig() derived from validated AppSpec fields.
      //     Only fires when the template actually uses it. The heuristic is
      //     "either branding.primary_color or content.* is present"; for v0.4 that
      //     maps 1:1 to video_grid_channel. Future templates can tighten.
      let templateConfigBrs: string | undefined;
      const content = (
        appSpec as {
          content?: {
            feed_url?: string;
            feed_format?: string;
            live_label?: string;
            service_name?: string;
          };
        }
      ).content;
      if (brandingSpec.primary_color || content || effectivePrimaryColor) {
        const cfg: Record<string, string> = {
          channel_name: appSpec.app.name,
        };
        if (brandingSpec.primary_color) cfg['primary_color'] = brandingSpec.primary_color;
        if (content?.feed_url) cfg['feed_url'] = content.feed_url;
        if (content?.feed_format) cfg['feed_format'] = content.feed_format;
        if (content?.live_label) cfg['live_label'] = content.live_label;
        if (content?.service_name) cfg['service_name'] = content.service_name;
        templateConfigBrs = emitTemplateConfigBs(cfg);
      }

      // 10. Assemble EmittedProject (conflicts, topo-sort, wiring, manifest merge,
      //     config.bs + __init_hooks.bs emission, provenance).
      const project = await buildEmittedProject({
        spec: appSpec,
        template: tmpl,
        modules,
        renderedTemplateFiles,
        moduleFileBytes,
        brsGenVersion: PKG_VERSION,
        ...(assetBuckets !== undefined ? { assetBuckets } : {}),
        ...(assetManifestEntries !== undefined ? { assetManifestEntries } : {}),
        ...(templateConfigBrs !== undefined ? { templateConfigBrs } : {}),
      });

      // 11. Write to disk.
      const outputDir = args['output_dir'] as string;
      await writeProject({
        outputDir,
        files: project.files,
        overwrite: Boolean(args['overwrite']),
      });

      // 12. Mandatory bsc compile pre-zip.
      const compileRes = await compileProject(outputDir);
      if (!compileRes.ok) throw compileRes.failure;
      for (const d of compileRes.diagnostics.filter((dd) => dd.severity === 'warning')) {
        warnings.push({
          code: 'BSC_LINT_WARNING',
          message: `${d.file}:${d.line} ${d.message}`,
        });
      }

      // 12a. Count files that will end up in the final artifact (post-compile
      //      tree minus the excluded tooling dirs). project.files.length is
      //      pre-compile and includes .bs sources the compile sweep removed,
      //      so it overcounts.
      const filesWritten = await countFilesOnDisk(outputDir, [
        '.rokudev-tools/staging',
        '.rokudev-tools/sourcemaps',
      ]);

      // 13. Optional zip.
      let zipPath: string | undefined;
      let zipBytes: number | undefined;
      if (args['zip']) {
        const zipArg = args['zip'];
        zipPath =
          typeof zipArg === 'object' &&
          zipArg !== null &&
          'output_zip' in zipArg &&
          typeof (zipArg as { output_zip?: unknown }).output_zip === 'string'
            ? (zipArg as { output_zip: string }).output_zip
            : `${outputDir}.zip`;
        await packageProject({
          projectDir: outputDir,
          outputZip: zipPath,
          exclude: ['.rokudev-tools/sourcemaps', '.rokudev-tools/staging'],
        });
        zipBytes = (await stat(zipPath)).size;
      }

      // 14. Optional sideload. brs-gen does not resolve from the device registry;
      //     callers must pass host + dev_password explicitly (spec §1.3).
      let sideloadResult: unknown;
      if (args['sideload']) {
        const sl = args['sideload'] as { device?: unknown; dev_password?: unknown };
        const device = sl.device;
        const devPassword = sl.dev_password;
        if (typeof device !== 'string' || device.length === 0) {
          throw fail('DEVICE_NOT_RESOLVED', 'sideload.device (host string) is required', {
            tried: ['sideload.device'],
          });
        }
        if (typeof devPassword !== 'string' || devPassword.length === 0) {
          throw fail(
            'DEVICE_NO_PASSWORD',
            'sideload.dev_password is required; brs-gen does not resolve from the device registry',
            { device },
          );
        }
        if (!zipPath) {
          throw fail(
            'NOT_IMPLEMENTED',
            'sideload requires zip: true (must zip before sideloading)',
            {},
          );
        }
        const portal = new DevPortal(device, devPassword);
        sideloadResult = await portal.sideload(zipPath);
      }

      // 15. Result envelope.
      const payload: Record<string, unknown> = {
        ok: true,
        project_dir: outputDir,
        files_written: filesWritten,
        manifest_keys: [...project.manifest.keys()].sort(),
        init_order: project.initOrder,
      };
      if (zipPath) {
        payload['zip_path'] = zipPath;
        payload['zip_bytes'] = zipBytes;
      }
      if (sideloadResult !== undefined) {
        payload['sideload'] = sideloadResult;
      }
      if (warnings.length > 0) {
        payload['details'] = { warnings };
      }
      return payload;
    },
  });
});
