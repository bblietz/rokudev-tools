import { ProgramBuilder } from 'brighterscript';
import { dirname, join, relative } from 'node:path';
import { copyFile, mkdir, readdir, rename, rm, unlink } from 'node:fs/promises';
import { fail, type Failure } from '@rokudev/device-client';

export type CompileDiagnostic = {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  file: string;
  line: number;
  col: number;
};

type CompileResult =
  | { ok: true; diagnostics: CompileDiagnostic[] }
  | { ok: false; failure: Failure };

async function walkRel(dir: string, base: string): Promise<string[]> {
  const out: string[] = [];
  for (const d of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, d.name);
    if (d.isDirectory()) out.push(...(await walkRel(full, base)));
    else if (d.isFile()) out.push(relative(base, full));
  }
  return out;
}

/**
 * Walk the project tree looking for .bs files and delete any stale .brs
 * counterparts that were emitted by a previous compile. This prevents
 * brighterscript from loading both the .bs source and the .brs output as
 * separate program files, which would produce duplicate-function diagnostics
 * on re-compilation.
 */
async function removeStaleOutputs(dir: string): Promise<void> {
  for (const d of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, d.name);
    if (d.isDirectory()) {
      // Skip .rokudev-tools entirely; it is our own tooling directory.
      if (d.name === '.rokudev-tools') continue;
      await removeStaleOutputs(full);
    } else if (d.isFile() && d.name.endsWith('.bs')) {
      const stale = full.slice(0, -3) + '.brs';
      try {
        await unlink(stale);
      } catch {
        /* not present or not writable; ignore */
      }
    }
  }
}

export async function compileProject(projectDir: string): Promise<CompileResult> {
  const staging = join(projectDir, '.rokudev-tools', 'staging');
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });

  // Remove any .brs files that were emitted by a previous compile so that
  // brighterscript does not see both the .bs source and the stale .brs output.
  await removeStaleOutputs(projectDir);

  const builder = new ProgramBuilder();
  // Suppress console noise from brighterscript during in-process invocation.
  builder.allowConsoleClearing = false;

  let diags: CompileDiagnostic[] = [];
  try {
    await builder.run({
      cwd: projectDir,
      rootDir: projectDir,
      stagingDir: staging,
      // copyToStaging: true triggers the transpile step inside run().
      // createPackage: false prevents zip creation.
      copyToStaging: true,
      createPackage: false,
      watch: false,
      sourceMap: true,
      showDiagnosticsInConsole: false,
      logLevel: 'off',
      diagnosticSeverityOverrides: {},
    });
    // getDiagnostics() on the builder aggregates staticDiagnostics + program diagnostics.
    diags = builder.getDiagnostics().map<CompileDiagnostic>((d) => ({
      severity: d.severity === 1 ? 'error' : d.severity === 2 ? 'warning' : 'info',
      code: String((d as { code?: unknown }).code ?? 'unknown'),
      message: d.message,
      file: (d.file as { srcPath?: string } | undefined)?.srcPath ?? '<unknown>',
      line: (d.range?.start?.line ?? 0) + 1,
      col: (d.range?.start?.character ?? 0) + 1,
    }));
  } catch (e) {
    await rm(staging, { recursive: true, force: true });
    builder.dispose();
    return {
      ok: false,
      failure: fail(
        'COMPILE_FAILED',
        `bsc compile threw: ${e instanceof Error ? e.message : String(e)}`,
        { cause: String(e) },
      ),
    };
  }

  const errors = diags.filter((d) => d.severity === 'error');
  if (errors.length > 0) {
    await rm(staging, { recursive: true, force: true });
    builder.dispose();
    return {
      ok: false,
      failure: fail('LINT_FAILED', `bsc reported ${errors.length} error(s)`, {
        diagnostics: diags,
      }),
    };
  }

  // Post-compile sweep:
  // - .brs files: copy to projectDir (in-place, replacing .bs sources)
  // - .brs.map files: move to .rokudev-tools/sourcemaps/<relpath>
  // - other files (manifest, bslib.brs, etc.): skip (not needed in-place)
  const stagedFiles = await walkRel(staging, staging);
  const sourcemapRoot = join(projectDir, '.rokudev-tools', 'sourcemaps');
  await rm(sourcemapRoot, { recursive: true, force: true });

  for (const rel of stagedFiles) {
    const src = join(staging, rel);
    if (rel.endsWith('.brs.map')) {
      const dest = join(sourcemapRoot, rel);
      await mkdir(dirname(dest), { recursive: true });
      await rename(src, dest);
    } else if (rel.endsWith('.brs')) {
      const dest = join(projectDir, rel);
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(src, dest);
      // Delete the .bs source that the Roku device cannot load.
      const bsPath = dest.replace(/\.brs$/, '.bs');
      try {
        await unlink(bsPath);
      } catch {
        /* .bs may not exist (e.g. bslib.brs has no .bs counterpart) */
      }
    }
  }

  builder.dispose();
  await rm(staging, { recursive: true, force: true });
  return { ok: true, diagnostics: diags };
}
