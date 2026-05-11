import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveAssetPath } from './resolve.js';
import { validateAssetSource, type SizeRule } from './validate.js';
import { synthesizeSolidPng } from './synthesize.js';
import { ICON_SOURCE_MIN, SPLASH_SOURCE_MIN } from './constants.js';

export type AssetKind = 'icon' | 'splash';

export type ResolvedAssetSource =
  | { source: 'operator'; bytes: Buffer }
  | { source: 'template-static'; bytes: Buffer }
  | { source: 'synthesized'; bytes: Buffer }
  | { source: 'none'; bytes?: undefined };

export type ResolveInput = {
  specAssetPath: string | undefined;
  specOrigin: string | null;
  templateRoot: string;
  templateDefaultPath: string | undefined;
  effectivePrimaryColor: string | undefined;
  kind: AssetKind;
  /** Minimum source dimensions for validation. Must be a SizeRule ({min_width, min_height}). */
  sourceMin: SizeRule;
  /** Skip source-PNG dimension/format validation. Tests only. */
  noValidate?: boolean;
};

const SYNTH_DIMENSIONS: Record<AssetKind, { width: number; height: number }> = {
  icon: { width: ICON_SOURCE_MIN.min_width, height: ICON_SOURCE_MIN.min_height },
  splash: { width: SPLASH_SOURCE_MIN.min_width, height: SPLASH_SOURCE_MIN.min_height },
};

/**
 * Resolve an asset's source bytes via precedence: operator > template-static >
 * synthesized > none. The caller decides what to do with `source: 'none'`
 * (usually: omit the manifest key).
 */
export async function resolveAssetSource(input: ResolveInput): Promise<ResolvedAssetSource> {
  const { specAssetPath, specOrigin, templateRoot, templateDefaultPath } = input;

  if (specAssetPath) {
    const abs = resolveAssetPath(specAssetPath, specOrigin);
    const bytes = await readFile(abs);
    if (!input.noValidate) {
      await validateAssetSource(bytes, input.sourceMin, {
        field: `branding.${input.kind}`,
        path: abs,
      });
    }
    return { source: 'operator', bytes };
  }

  if (templateDefaultPath) {
    const abs = join(templateRoot, templateDefaultPath);
    const bytes = await readFile(abs);
    if (!input.noValidate) {
      await validateAssetSource(bytes, input.sourceMin, {
        field: `template.branding_defaults.${input.kind}`,
        path: abs,
      });
    }
    return { source: 'template-static', bytes };
  }

  if (input.effectivePrimaryColor) {
    const dims = SYNTH_DIMENSIONS[input.kind];
    const bytes = await synthesizeSolidPng(
      input.effectivePrimaryColor,
      dims.width,
      dims.height,
    );
    return { source: 'synthesized', bytes };
  }

  return { source: 'none' };
}
