import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { registerAllTools, type ToolDef } from './_register.js';
import './lint.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpBase() {
  return join(tmpdir(), `brs-gen-t27-${randomUUID().slice(0, 8)}-`);
}

/**
 * Write a minimal Roku project with the given BrightScript body in source/main.bs.
 * Returns the project directory path.
 */
async function writeMiniProject(dir: string, mainBody: string): Promise<void> {
  await mkdir(join(dir, 'source'), { recursive: true });
  await writeFile(
    join(dir, 'manifest'),
    'title=LintTest\nmajor_version=1\nminor_version=0\nbuild_version=0\nui_resolutions=fhd\n',
    'utf8',
  );
  await writeFile(join(dir, 'source/main.bs'), mainBody, 'utf8');
  await writeFile(
    join(dir, 'bsconfig.json'),
    JSON.stringify({ sourceMap: true, rootDir: '.' }),
    'utf8',
  );
}

/**
 * Snapshot a directory: returns a Map<relPath, Buffer> for every file found
 * recursively under `dir`. Relative paths use the OS path separator.
 */
async function snapshotDir(dir: string): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const ent of entries) {
      const full = join(current, ent.name);
      if (ent.isDirectory()) {
        await walk(full);
      } else if (ent.isFile()) {
        const rel = full.slice(dir.length + 1); // strip leading dir + sep
        out.set(rel, await readFile(full));
      }
    }
  }
  await walk(dir);
  return out;
}

function snapshotsEqual(a: Map<string, Buffer>, b: Map<string, Buffer>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, va] of a) {
    const vb = b.get(k);
    if (!vb) return false;
    if (!va.equals(vb)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('lint tool', () => {
  let handler: ToolDef['handler'];
  let projectDir: string;

  beforeEach(async () => {
    const tools = new Map<string, ToolDef>();
    registerAllTools(tools);
    const t = tools.get('lint');
    if (!t) throw new Error('lint not registered');
    handler = t.handler;

    projectDir = await mkdtemp(makeTmpBase());
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // T1: Clean project
  // -------------------------------------------------------------------------

  it('returns ok=true and empty diagnostics for a clean project', async () => {
    await writeMiniProject(
      projectDir,
      'sub Main(args as dynamic) as void\n  print "hello"\nend sub\n',
    );

    const r = await handler({ project_dir: projectDir });
    const payload = JSON.parse(
      (r as { content: [{ text: string }] }).content[0].text,
    ) as { ok: boolean; diagnostics: unknown[] };

    expect(payload.ok).toBe(true);
    expect(payload.diagnostics).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // T2: Syntax error
  // -------------------------------------------------------------------------

  it('returns ok=false with error diagnostics for a syntax error', async () => {
    // Unclosed string literal is reliably a syntax error in bsc.
    await writeMiniProject(
      projectDir,
      'sub Main(args as dynamic) as void\n  print "unterminated\nend sub\n',
    );

    const r = await handler({ project_dir: projectDir });
    const payload = JSON.parse(
      (r as { content: [{ text: string }] }).content[0].text,
    ) as { ok: boolean; diagnostics: Array<{ severity: string; message: string }> };

    expect(payload.ok).toBe(false);
    expect(payload.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // T3: Warning only — skipped with explanation
  // -------------------------------------------------------------------------
  //
  // bsc does not reliably emit warnings for common constructs (unused variables
  // are errors by default in newer bsc; other constructs differ per version).
  // Triggering a stable warning-only run requires deep knowledge of the
  // installed bsc version's rule set, which makes this test inherently fragile.
  // The remapping logic is exercised indirectly through T5 (error path) and T1
  // (success path with warnings=[]). This test is intentionally omitted.

  // -------------------------------------------------------------------------
  // T4: project_dir is unchanged after lint
  // -------------------------------------------------------------------------

  it('does not mutate project_dir (no .bs -> .brs conversion in the original tree)', async () => {
    await writeMiniProject(
      projectDir,
      'sub Main(args as dynamic) as void\n  print "hello"\nend sub\n',
    );

    const before = await snapshotDir(projectDir);
    await handler({ project_dir: projectDir });
    const after = await snapshotDir(projectDir);

    expect(snapshotsEqual(before, after)).toBe(true);
  });

  it('does not mutate project_dir even when linting a project with syntax errors', async () => {
    await writeMiniProject(
      projectDir,
      'sub Main(args as dynamic) as void\n  print "unterminated\nend sub\n',
    );

    const before = await snapshotDir(projectDir);
    await handler({ project_dir: projectDir });
    const after = await snapshotDir(projectDir);

    expect(snapshotsEqual(before, after)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // T5: Diagnostic file paths point into project_dir, not into a tmpdir
  // -------------------------------------------------------------------------

  it('remaps diagnostic file paths to project_dir (not a tmpdir path)', async () => {
    await writeMiniProject(
      projectDir,
      'sub Main(args as dynamic) as void\n  print "unterminated\nend sub\n',
    );

    const r = await handler({ project_dir: projectDir });
    const payload = JSON.parse(
      (r as { content: [{ text: string }] }).content[0].text,
    ) as { ok: boolean; diagnostics: Array<{ file: string; severity: string }> };

    expect(payload.ok).toBe(false);
    const errorDiags = payload.diagnostics.filter((d) => d.severity === 'error');
    expect(errorDiags.length).toBeGreaterThan(0);

    for (const d of errorDiags) {
      // Must start with projectDir, NOT with os.tmpdir() or any brs-gen-lint- prefix.
      expect(d.file).toSatisfy(
        (f: string) => f.startsWith(projectDir),
        `expected diagnostic file to start with projectDir="${projectDir}", got "${d.file}"`,
      );
      // Specifically must NOT contain the tmpdir prefix pattern.
      expect(d.file).not.toContain('brs-gen-lint-');
    }
  });
});
