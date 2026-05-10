import { fail } from '@rokudev/device-client';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

export type SizeRule = { min_width: number; min_height: number };
export type ValidateContext = { field: string; path?: string };

/**
 * Validate a user-supplied source PNG:
 *   - must start with PNG magic (89 50 4e 47);
 *   - width + height from the IHDR chunk must meet min_width / min_height.
 *
 * Returns {width, height} on success. Throws `ASSET_VALIDATION_FAILED`
 * otherwise, with `details.reason` ∈ {'not_a_png', 'source_too_small'}.
 */
export async function validateAssetSource(
  source: Buffer,
  rule: SizeRule,
  context: ValidateContext,
): Promise<{ width: number; height: number }> {
  if (source.length < 4 || !source.subarray(0, 4).equals(PNG_MAGIC)) {
    throw fail('ASSET_VALIDATION_FAILED', `${context.field} is not a PNG`, {
      reason: 'not_a_png',
      field: context.field,
      path: context.path,
    });
  }
  // IHDR dimensions live at offset 16 (width) and 20 (height), big-endian u32.
  if (source.length < 24) {
    throw fail('ASSET_VALIDATION_FAILED', `${context.field} PNG truncated before IHDR`, {
      reason: 'not_a_png',
      field: context.field,
      path: context.path,
    });
  }
  const width = source.readUInt32BE(16);
  const height = source.readUInt32BE(20);
  if (width < rule.min_width || height < rule.min_height) {
    throw fail(
      'ASSET_VALIDATION_FAILED',
      `${context.field} source PNG (${width}x${height}) smaller than required ${rule.min_width}x${rule.min_height}`,
      {
        reason: 'source_too_small',
        given: `${width}x${height}`,
        required: `${rule.min_width}x${rule.min_height}`,
        field: context.field,
        path: context.path,
      },
    );
  }
  return { width, height };
}
