import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { fail, warn } from '@rokudev/device-client';

export type VersionState =
  | { ok: true }
  | { ok: true; warning: ReturnType<typeof warn> }
  | { ok: false; failure: ReturnType<typeof fail> };

async function readOwnPackageJson(myDir: string): Promise<{ version: string }> {
  // Try the current directory first (test fixtures, running from source).
  // If not found, walk up one level -- production build puts compiled JS in dist/
  // while package.json lives at the package root.
  for (const dir of [myDir, resolve(myDir, '..')]) {
    try {
      return JSON.parse(await readFile(resolve(dir, 'package.json'), 'utf8')) as {
        version: string;
      };
    } catch {
      // continue
    }
  }
  throw new Error(`package.json not found in ${myDir} or its parent`);
}

export async function checkSiblings(myImportMetaUrl: string): Promise<VersionState> {
  const myDir = dirname(fileURLToPath(myImportMetaUrl));
  const me = await readOwnPackageJson(myDir);
  const mine = String(me.version);
  const mineMajor = parseInt(mine.split('.')[0]!, 10);
  // Resolve sibling: @rokudev/device-client. require() is unavailable in ESM,
  // so synthesize a CommonJS-style require bound to this module's URL.
  const require = createRequire(myImportMetaUrl);
  let siblingVersion: string | undefined;
  try {
    const siblingPath = require.resolve('@rokudev/device-client/package.json');
    siblingVersion = (JSON.parse(await readFile(siblingPath, 'utf8')) as { version: string })
      .version;
  } catch {
    // sibling not findable; nothing to check (e.g. running from source).
    return { ok: true };
  }
  const sibMajor = parseInt(siblingVersion.split('.')[0]!, 10);
  if (sibMajor !== mineMajor) {
    return {
      ok: false,
      failure: fail(
        'CROSS_PACKAGE_VERSION_MISMATCH',
        `brs-gen@${mine} requires @rokudev/device-client@${mineMajor}.x; found ${siblingVersion}`,
        {
          package: '@rokudev/device-client',
          installed_version: siblingVersion,
          expected_version: `${mineMajor}.x`,
        },
      ),
    };
  }
  if (siblingVersion !== mine) {
    return {
      ok: true,
      warning: warn(
        'CROSS_PACKAGE_VERSION_MISMATCH',
        `version drift: brs-gen ${mine} vs @rokudev/device-client ${siblingVersion}`,
        {
          package: '@rokudev/device-client',
          installed_version: siblingVersion,
          expected_version: mine,
        },
      ),
    };
  }
  return { ok: true };
}
