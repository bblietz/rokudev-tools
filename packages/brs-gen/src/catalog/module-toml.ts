import { z } from 'zod';
import semver from 'semver';

const SemverRange = z.string().refine((s) => semver.validRange(s) !== null, 'invalid semver range');

const ExportEntry = z.object({
  kind: z.enum(['init_fn', 'scene_node', 'helper']),
  name: z.string().min(1),
  file: z.string().min(1).optional(),
}).strict();

const RequireEntry = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('init_hook'), scope: z.string(), phase: z.string() }).strict(),
  z.object({ kind: z.literal('scene_node'), name: z.string() }).strict(),
]);

export const ModuleTomlSchema = z.object({
  module: z.object({
    id: z.string().min(1),
    version: z.string().refine((s) => semver.valid(s) !== null, 'invalid semver'),
    spec_compat: SemverRange,
    description: z.string(),
  }).strict(),
  module_config_schema: z.record(z.unknown()),
  module_files: z.object({ add: z.array(z.string().min(1)) }).strict(),
  module_manifest: z.record(z.string()).optional(),
  module_wiring: z.object({
    exports: z.array(ExportEntry),
    requires: z.array(RequireEntry),
    init_calls: z.array(z.object({
      hook: z.string().min(1), statement: z.string().min(1),
    }).strict()),
  }).strict(),
  module_ordering: z.object({ before: z.array(z.string()), after: z.array(z.string()) }).strict(),
  module_conflicts: z.object({ exclusive_with: z.array(z.string()) }).strict(),
}).strict();

export type ModuleToml = z.infer<typeof ModuleTomlSchema>;
