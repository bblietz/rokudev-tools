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

export const TemplateTomlSchema = z
  .object({
    template: z
      .object({
        id: z.string().min(1),
        version: z.string().refine((s) => semver.valid(s) !== null, 'invalid semver'),
        spec_compat: SemverRange,
        description: z.string(),
      })
      .strict(),
    template_exports: z
      .object({
        init_hooks: z.array(
          z
            .object({
              scope: BrsIdentifier,
              phase: BrsIdentifier,
              file: z.string().min(1),
              signature: z.string().min(1),
            })
            .strict(),
        ),
        scene_nodes: z.array(
          z.object({ name: z.string().min(1), file: z.string().min(1) }).strict(),
        ),
      })
      .strict(),
    template_manifest_defaults: z.record(z.string()),
    template_supported_modules: z
      .object({ allowlist: z.array(z.string()) })
      .strict()
      .optional(),
    template_suppressed_warnings: z
      .object({ codes: z.array(z.string()) })
      .strict()
      .optional(),
    template_branding_defaults: z
      .object({
        icon: z.string().optional(),
        splash: z.string().optional(),
        primary_color: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/, 'must be a 6-digit hex color like #RRGGBB')
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type TemplateToml = z.infer<typeof TemplateTomlSchema>;
