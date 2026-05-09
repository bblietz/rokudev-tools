import { mkdtemp, rm, cp } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { registerToolsModule } from './_register.js';
import { compileProject, type CompileDiagnostic } from '../build/compile.js';

/**
 * Remap a diagnostic's `file` path from an absolute tmpdir-rooted path back
 * to the original `projectDir`. Uses `relative` + `join` for cross-platform
 * correctness rather than raw string slicing on `/` vs `path.sep`.
 */
function remapDiagnosticFile(
  diag: CompileDiagnostic,
  tmpDir: string,
  projectDir: string,
): CompileDiagnostic {
  const file = diag.file;
  // relative() returns a path starting with '..' when `file` is not under
  // `tmpDir`. In that case, leave the path as-is.
  const rel = relative(tmpDir, file);
  if (rel.startsWith('..') || rel === '') return diag;
  return { ...diag, file: join(projectDir, rel) };
}

registerToolsModule((tools) => {
  tools.set('lint', {
    name: 'lint',
    description:
      'Run a BrightScript/BrighterScript compile (bsc) on an existing project directory ' +
      'without mutating it. Stages the project into a temporary directory first, ' +
      'delegates to compileProject, remaps diagnostics back to project_dir paths, ' +
      'then cleans up the temporary directory. Returns {ok, diagnostics}.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['project_dir'],
      properties: {
        project_dir: { type: 'string', minLength: 1 },
      },
    },
    handler: async (args) => {
      const projectDir = args['project_dir'] as string;

      // Create a unique staging tmpdir for the project copy.
      const tmpDir = await mkdtemp(join(tmpdir(), `brs-gen-lint-${randomUUID().slice(0, 8)}-`));

      let ok: boolean;
      let diagnostics: CompileDiagnostic[];

      try {
        // Recursively copy everything from projectDir into tmpDir.
        // `cp` with `recursive: true` is available from Node 16.7+.
        await cp(projectDir, tmpDir, { recursive: true });

        // Run the bsc compile inside the staged tmpdir.
        const result = await compileProject(tmpDir);

        if (result.ok) {
          // Success path: remap any warning-level diagnostics to projectDir paths.
          ok = true;
          diagnostics = result.diagnostics.map((d) => remapDiagnosticFile(d, tmpDir, projectDir));
        } else {
          // Failure path: two sub-cases.
          //
          //   LINT_FAILED  — bsc ran but reported errors; diagnostics are in
          //                  result.failure.details.diagnostics. Surface as
          //                  {ok:false, diagnostics} so the caller sees real paths.
          //
          //   COMPILE_FAILED — bsc threw (infrastructural); no per-file
          //                    diagnostics are meaningful. Rethrow so the MCP
          //                    caller sees a typed failure.
          if (result.failure.code === 'LINT_FAILED') {
            const raw = (result.failure.details?.['diagnostics'] ?? []) as CompileDiagnostic[];
            ok = false;
            diagnostics = raw.map((d) => remapDiagnosticFile(d, tmpDir, projectDir));
          } else {
            throw result.failure;
          }
        }
      } finally {
        // Always clean up the tmpdir, even on error.
        await rm(tmpDir, { recursive: true, force: true });
      }

      return { ok, diagnostics };
    },
  });
});
