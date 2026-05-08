/**
 * findSourceMap: locate the .brs.map for a .bs file in a BrighterScript project.
 *
 * BrighterScript writes compiled outputs to its stagingFolderPath. Source maps
 * are named <rel-source>.brs.map, where the .bs extension is replaced with
 * .brs.map.
 *
 * Staleness note: when bsconfig.json specifies a non-default stagingFolderPath,
 * the configured path is authoritative and is checked first. The two fallback
 * paths (out/.roku-deploy-staging and .roku-deploy-staging) may surface stale
 * maps left over from previous build configurations. If stagingFolderPath is
 * explicitly set, the fallbacks are NOT checked to avoid surfacing stale maps.
 */

import { readFile, access } from 'node:fs/promises';
import { dirname, resolve, relative, join } from 'node:path';

interface BsConfig {
  stagingFolderPath?: string;
  rootDir?: string;
}

/**
 * Walk up from startDir looking for bsconfig.json.
 * Stops at `ceiling` (inclusive) if provided, otherwise walks to the filesystem root.
 */
async function findBsConfig(startDir: string, ceiling?: string): Promise<string | null> {
  let dir = startDir;
  const stopAt = ceiling ? resolve(ceiling) : '/';
  while (true) {
    const candidate = resolve(dir, 'bsconfig.json');
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* not found here, continue */
    }
    const parent = dirname(dir);
    if (parent === dir || resolve(dir) === stopAt) return null;
    dir = parent;
  }
}

/**
 * Parse bsconfig.json with best-effort JSON parsing.
 * Returns null if the file content is not valid JSON.
 */
function parseBsConfig(content: string): BsConfig | null {
  try {
    return JSON.parse(content) as BsConfig;
  } catch {
    return null;
  }
}

/**
 * Check whether a path exists on disk (file or directory).
 */
async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Locate the .brs.map file for a given .bs source file in a BrighterScript project.
 *
 * @param bsFilePath  - Absolute path to the .bs source file.
 * @param projectRoot - Optional ceiling directory for the bsconfig.json walk.
 *                      If not provided, walks up to the filesystem root.
 * @returns Absolute path to the .brs.map file, or null if not found.
 */
export async function findSourceMap(
  bsFilePath: string,
  projectRoot?: string,
): Promise<string | null> {
  const absFilePath = resolve(bsFilePath);
  const fileDir = dirname(absFilePath);

  // Step 1: walk up to find bsconfig.json
  const bsConfigPath = await findBsConfig(fileDir, projectRoot);
  if (bsConfigPath === null) return null;

  const bsConfigDir = dirname(bsConfigPath);

  // Step 2: parse bsconfig.json
  let content: string;
  try {
    content = await readFile(bsConfigPath, 'utf8');
  } catch {
    return null;
  }

  const config = parseBsConfig(content);
  if (config === null) return null;

  const stagingFolderPath = config.stagingFolderPath;
  const rootDir = config.rootDir ?? './';

  // Step 3: compute relative path of bsFilePath from <bsconfig-dir>/<rootDir>
  const rootDirAbs = resolve(bsConfigDir, rootDir);
  const relPath = relative(rootDirAbs, absFilePath);

  // Replace .bs extension with .brs.map
  const mapRelPath = relPath.replace(/\.bs$/, '.brs.map');

  // Step 4: look for the map in priority order
  if (stagingFolderPath !== undefined) {
    // Configured stagingFolderPath is authoritative; do NOT fall through to fallbacks
    // to prevent surfacing stale maps from previous build configurations.
    const candidate = join(bsConfigDir, stagingFolderPath, mapRelPath);
    if (await exists(candidate)) return candidate;
    return null;
  }

  // No stagingFolderPath configured; check fallback locations in order.
  const fallbacks = [
    join(bsConfigDir, 'out', '.roku-deploy-staging', mapRelPath),
    join(bsConfigDir, '.roku-deploy-staging', mapRelPath),
  ];

  for (const candidate of fallbacks) {
    if (await exists(candidate)) return candidate;
  }

  return null;
}
