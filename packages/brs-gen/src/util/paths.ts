import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Walk up from a file:// URL until a package.json is found.
 * Works from both packages/brs-gen/src/<...> (dev/test) and
 * packages/brs-gen/dist/<...> (published) locations, because both
 * sit inside the same package root.
 */
export async function findPkgRoot(fromUrl: string): Promise<string> {
  let dir = dirname(fileURLToPath(fromUrl));
  for (let i = 0; i < 8; i++) {
    try {
      await stat(join(dir, 'package.json'));
      return dir;
    } catch {
      // keep climbing
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`could not locate package.json from ${fromUrl}`);
}

/**
 * Dynamic-import a template's schema file. Tries schema.ts then schema.js;
 * returns null if neither exists. Tests and dev run from src/, where
 * vite-node resolves .ts; dist consumers would need a compiled .js which
 * is not currently emitted (schemas under templates/ are excluded from tsc;
 * follow-up).
 */
export async function importTemplateSchema(
  pkgRoot: string,
  templateId: string,
): Promise<{ Schema?: unknown; Example?: unknown } | null> {
  for (const ext of ['ts', 'js'] as const) {
    const p = join(pkgRoot, 'templates', templateId, `schema.${ext}`);
    try {
      await stat(p);
    } catch {
      continue;
    }
    try {
      return (await import(pathToFileURL(p).href)) as {
        Schema?: unknown;
        Example?: unknown;
      };
    } catch {
      // A schema file exists but cannot be imported (e.g. syntax error). Fall
      // through to the next extension, then surface as "no schema" to preserve
      // the prior silent-skip behavior.
    }
  }
  return null;
}

/**
 * Read the `version` field from a package.json at `pkgRoot`. Returns
 * '0.0.0' if the file is missing or the field is absent.
 */
export async function readPkgVersion(pkgRoot: string): Promise<string> {
  try {
    const pkg = JSON.parse(await readFile(join(pkgRoot, 'package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
