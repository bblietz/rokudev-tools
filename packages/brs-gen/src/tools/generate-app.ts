import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';
import { fail, DevPortal } from '@rokudev/device-client';
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

// Resolve the packages/brs-gen directory at runtime. Works both from
// src/tools/ at test/dev time (vite-node) and from dist/tools/ at runtime.
const pkgRoot = fileURLToPath(new URL('../../', import.meta.url));

// Read the package.json version once at module load so the value is pinned
// for the lifetime of the server process. Same pattern as bootstrap's
// readServerVersion but in-module async by walking up from our own file.
async function readPkgVersion(): Promise<string> {
  const myDir = dirname(fileURLToPath(import.meta.url));
  for (const dir of [myDir, resolve(myDir, '..'), resolve(myDir, '../..')]) {
    try {
      const pkg = JSON.parse(await readFile(resolve(dir, 'package.json'), 'utf8')) as {
        version?: string;
      };
      if (pkg.version) return pkg.version;
    } catch {
      // continue
    }
  }
  return '0.0.0';
}
const PKG_VERSION = await readPkgVersion();

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
      'Render a Roku channel project from a validated AppSpec: merges the template with '
      + 'feature modules, writes the project tree, runs a bsc compile, and optionally zips '
      + 'and sideloads. Deterministic (Path A); freeform LLM path (spec.freeform) is rejected '
      + 'as NOT_IMPLEMENTED in Plan 3.',
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

      // 1. Parse input: string starting with '{' -> inline JSON; other string ->
      //    filesystem path; object -> passthrough unchanged.
      const specInput = await (async () => {
        if (typeof args['spec'] === 'string') {
          const s = args['spec'].trim();
          if (s.startsWith('{')) return JSON.parse(s);
          return JSON.parse(await readFile(args['spec'], 'utf8'));
        }
        return args['spec'];
      })();

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
      //     exporting a strict `Schema`. Dynamic import path mirrors T20.
      const schemaUrl = new URL(`../../templates/${spec.template}/schema.ts`, import.meta.url);
      let templateMod: { Schema?: { safeParse: (x: unknown) => { success: boolean; error?: { issues: unknown } } } } = {};
      try {
        templateMod = (await import(schemaUrl.href)) as typeof templateMod;
      } catch {
        // Templates that ship without schema.ts skip the strict pass; not a warning.
      }
      if (templateMod.Schema) {
        const strict = templateMod.Schema.safeParse(spec);
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
            message:
              `module ${ref.id} reference omits version_range; using installed ${m.module.version}`,
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

      // 10. Assemble EmittedProject (conflicts, topo-sort, wiring, manifest merge,
      //     config.bs + __init_hooks.bs emission, provenance).
      const project = await buildEmittedProject({
        spec: appSpec,
        template: tmpl,
        modules,
        renderedTemplateFiles,
        moduleFileBytes,
        brsGenVersion: PKG_VERSION,
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

      // 13. Optional zip.
      let zipPath: string | undefined;
      let zipBytes: number | undefined;
      if (args['zip']) {
        const zipArg = args['zip'];
        zipPath =
          typeof zipArg === 'object'
            && zipArg !== null
            && 'output_zip' in zipArg
            && typeof (zipArg as { output_zip?: unknown }).output_zip === 'string'
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
        files_written: project.files.length,
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
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(payload),
          },
        ],
      };
    },
  });
});
