import { z } from 'zod';
import semver from 'semver';

const SemverRange = z.string().refine((s) => semver.validRange(s) !== null, 'invalid semver range');
const BrsIdentifier = z
  .string()
  .min(1)
  .regex(
    /^[A-Za-z_][A-Za-z0-9_]*$/,
    'must be a valid BrightScript identifier (letters, digits, underscores; must not start with a digit)',
  );

const ExportEntry = z
  .object({
    kind: z.enum(['init_fn', 'scene_node', 'helper']),
    name: z.string().min(1),
    file: z.string().min(1).optional(),
  })
  .strict();

const RequireEntry = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('init_hook'), scope: BrsIdentifier, phase: BrsIdentifier }).strict(),
  z.object({ kind: z.literal('scene_node'), name: z.string() }).strict(),
]);

export const ModuleTomlSchema = z
  .object({
    module: z
      .object({
        id: z
          .string()
          .min(1)
          .regex(
            /^[A-Za-z_][A-Za-z0-9_.]*$/,
            'module.id must start with a letter or underscore and contain only letters, digits, underscores, or dots (dotted namespace notation, e.g. analytics.event_pipe)',
          ),
        version: z.string().refine((s) => semver.valid(s) !== null, 'invalid semver'),
        spec_compat: SemverRange,
        description: z.string(),
      })
      .strict(),
    module_config_schema: z.record(z.unknown()),
    module_files: z.object({ add: z.array(z.string().min(1)) }).strict(),
    module_manifest: z.record(z.string()).optional(),
    module_wiring: z
      .object({
        exports: z.array(ExportEntry),
        requires: z.array(RequireEntry),
        init_calls: z.array(
          z
            .object({
              hook: z.string().min(1),
              statement: z.string().min(1),
            })
            .strict(),
        ),
        optional_init_calls: z
          .array(
            z
              .object({
                hook: z.string().min(1),
                statement: z.string().min(1),
              })
              .strict(),
          )
          .default([]),
      })
      .strict(),
    module_ordering: z.object({ before: z.array(z.string()), after: z.array(z.string()) }).strict(),
    module_conflicts: z.object({ exclusive_with: z.array(z.string()) }).strict(),
  })
  .strict();

export type ModuleToml = z.infer<typeof ModuleTomlSchema>;
