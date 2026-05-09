import { mkdir, writeFile, rm, rename, access, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fail } from '@rokudev/device-client';

type WriteInput = {
  outputDir: string;
  files: ReadonlyArray<{ path: string; content: string | Buffer }>;
  overwrite: boolean;
};

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}
async function isNonEmpty(p: string): Promise<boolean> {
  try {
    return (await readdir(p)).length > 0;
  } catch {
    return false;
  }
}

export async function writeProject(input: WriteInput): Promise<void> {
  if ((await exists(input.outputDir)) && (await isNonEmpty(input.outputDir))) {
    if (!input.overwrite) {
      throw fail(
        'OUTPUT_DIR_NOT_EMPTY',
        `output_dir ${input.outputDir} is non-empty; pass overwrite: true to replace`,
        { stage: 'write', output_dir: input.outputDir },
      );
    }
  }

  // tmpdir inside dirname(output_dir) so fs.rename is same-filesystem and atomic.
  const parent = dirname(input.outputDir);
  await mkdir(parent, { recursive: true });
  const tmp = join(parent, `.brs-gen-tmp-${randomUUID()}`);
  await mkdir(tmp, { recursive: true });

  try {
    for (const f of input.files) {
      const dest = join(tmp, f.path);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, f.content);
    }

    if (await exists(input.outputDir)) {
      // one final rm (overwrite path), then rename
      await rm(input.outputDir, { recursive: true, force: true });
    }
    await rename(tmp, input.outputDir);
    // sanity-guard: if rename failed silently, clean up tmp
    if (await exists(tmp)) await rm(tmp, { recursive: true, force: true });
  } catch (e) {
    // Clean up the tmpdir on any error so repeated failed runs don't leave
    // orphaned `.brs-gen-tmp-*` dirs. Swallow cleanup failures so the original
    // error propagates.
    await rm(tmp, { recursive: true, force: true }).catch(() => {
      /* ignore */
    });
    throw e;
  }
}
