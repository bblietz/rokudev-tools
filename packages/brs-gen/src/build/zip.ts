import yazl from 'yazl';
import { readdir, readFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join, relative } from 'node:path';

type PackageInput = {
  projectDir: string;
  outputZip: string;
  /** Array of path prefixes (relative to projectDir) to exclude. */
  exclude?: ReadonlyArray<string>;
};

// DOS epoch = 1980-01-01T00:00:00 UTC
const DOS_EPOCH = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));

async function walk(dir: string, base: string): Promise<string[]> {
  const out: string[] = [];
  for (const d of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, d.name);
    const rel = relative(base, full);
    if (d.isDirectory()) out.push(...await walk(full, base));
    else if (d.isFile()) out.push(rel);
  }
  return out;
}

export async function packageProject(input: PackageInput): Promise<void> {
  const all = (await walk(input.projectDir, input.projectDir)).sort();
  const excluded = (p: string) => (input.exclude ?? []).some((pref) => p === pref || p.startsWith(pref + '/'));
  const zip = new yazl.ZipFile();

  for (const rel of all) {
    // Always normalize path separators to '/' (Windows -> POSIX) so zip entry
    // names match on every OS. relative() returns platform-native separators.
    const normRel = rel.split(/[\\/]/).join('/');
    if (excluded(normRel)) continue;
    const full = join(input.projectDir, rel);
    const bytes = await readFile(full);
    // Pin mtime, compression, AND the external-file-attributes field so the
    // zip is OS-independent. yazl's default mode comes from the host fs stat,
    // which varies by umask / file-create-mode; forcing 0o644 keeps bytes
    // equal across Linux, macOS, and Windows CI runs.
    //
    // `mode` has been honored by yazl since 2.5 (externalFileAttributes =
    // mode << 16). If the installed @types/yazl omits the field from the
    // options type (some versions do), the cast below keeps TS silent.
    zip.addBuffer(bytes, normRel,
      { mtime: DOS_EPOCH, compress: false, mode: 0o644 } as yazl.Options & { mode: number });
  }
  zip.end();

  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(input.outputZip);
    zip.outputStream.pipe(out).on('close', resolve).on('error', reject);
    zip.outputStream.on('error', reject);
  });
}
