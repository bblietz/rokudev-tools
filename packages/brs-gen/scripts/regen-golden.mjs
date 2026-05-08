// packages/brs-gen/scripts/regen-golden.mjs
//
// Manual regenerator for the golden fixtures consumed by tests/e2e.test.ts:
//
//   tests/__golden__/stub.zip
//   tests/__golden__/stub.provenance.json
//
// Run this by hand whenever a load-bearing change to the deterministic
// pipeline (template files, module files, manifest-key strategies, zip
// layout, etc.) is made. CI does NOT auto-regen (per spec §11.5); a human
// must stage both files along with a clear cause in the commit message.
//
// Prerequisites:
//   - pnpm -C packages/brs-gen build    # populates dist/
//
// Usage:
//   TZ=UTC pnpm -C packages/brs-gen exec node scripts/regen-golden.mjs
//
// WHY TZ=UTC:
//   yazl 2.5.x encodes the DOS mtime via Date#getFullYear() (local time),
//   not getUTCFullYear(). A regen on a host in a non-UTC timezone will
//   produce zip bytes that differ from a UTC-pinned e2e run, breaking the
//   byte-equality assertion. We force UTC here so the golden zip is stable
//   across contributors. The e2e test spawns node with TZ=UTC too.

process.env.TZ = 'UTC';

import { generateAppForRegen } from './regen-helper.mjs';
import { mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, '..');
const GOLDEN_DIR = join(PKG_ROOT, 'tests', '__golden__');

const CANONICAL_SPEC = {
  spec_version: 2,
  template: 'stub_hello',
  modules: [{ id: 'stub_label', version_range: '^0.1.0', config: { text: 'hello world' } }],
  app: { name: 'Stub Channel', major_version: 1, minor_version: 0, build_version: 0 },
};

async function main() {
  const work = join(tmpdir(), `brs-gen-regen-${randomUUID()}`);
  const outputDir = join(work, 'project');
  const outputZip = join(work, 'project.zip');
  await mkdir(work, { recursive: true });
  await mkdir(GOLDEN_DIR, { recursive: true });

  try {
    const { zip_path, output_dir } = await generateAppForRegen({
      outputDir,
      spec: CANONICAL_SPEC,
      outputZip,
    });

    // Golden zip.
    await copyFile(zip_path, join(GOLDEN_DIR, 'stub.zip'));

    // Golden provenance.json: pulled from the generated project tree. The
    // provenance file is what buildEmittedProject emits to
    // .rokudev-tools/provenance.json; we keep it as its raw bytes so the
    // e2e test can do a byte-equal compare.
    const provenance = await readFile(
      join(output_dir, '.rokudev-tools', 'provenance.json'),
    );
    await writeFile(join(GOLDEN_DIR, 'stub.provenance.json'), provenance);
  } finally {
    await rm(work, { recursive: true, force: true });
  }

  process.stdout.write(
    '\n========================================================================\n'
      + 'Golden files regenerated:\n'
      + `  ${join(GOLDEN_DIR, 'stub.zip')}\n`
      + `  ${join(GOLDEN_DIR, 'stub.provenance.json')}\n`
      + 'Please commit both files with a clear cause in the message\n'
      + '(e.g. "regen goldens: bump stub_hello template version").\n'
      + '========================================================================\n',
  );
}

main().catch((err) => {
  process.stderr.write(`regen-golden failed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
