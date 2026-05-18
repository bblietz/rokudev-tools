/**
 * Normalize a module id (which may contain dots, e.g. "analytics.event_pipe")
 * to a BrightScript-safe identifier segment. Dots are replaced with
 * underscores. The output is suitable for use as a function name suffix or
 * as a path segment under `source/_modules/`.
 *
 * Module ids use dotted namespace notation (e.g. `analytics.event_pipe`,
 * `auth.device_link_code`) per the rokudev-tools v1 module naming convention.
 * BrightScript identifiers do not permit dots, so the merger normalizes
 * dotted ids to underscores everywhere the id crosses into BrightScript
 * source or BrightScript-shaped filesystem paths. This helper is the single
 * source of truth for that translation; all merger sites must delegate here.
 */
export function moduleIdToBsId(moduleId: string): string {
  return moduleId.replaceAll('.', '_');
}
