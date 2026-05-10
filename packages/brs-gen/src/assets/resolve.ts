import { isAbsolute, dirname, resolve } from 'node:path';

/**
 * Resolve a user-supplied asset path against the origin of the AppSpec it
 * came from.
 *
 *   absolute path            → returned as-is
 *   relative path + origin   → resolved against dirname(origin)
 *   relative path + no origin → resolved against process.cwd()
 *
 * `specOrigin` is the absolute path of the spec file (when the input was a
 * filesystem path), or `null` when the spec was passed inline as an object
 * or JSON string.
 */
export function resolveAssetPath(assetPath: string, specOrigin: string | null): string {
  if (isAbsolute(assetPath)) return assetPath;
  const base = specOrigin ? dirname(specOrigin) : process.cwd();
  return resolve(base, assetPath);
}
