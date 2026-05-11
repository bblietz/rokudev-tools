// packages/brs-gen/templates/blank_scenegraph/schema.ts
import { z } from 'zod';

// Convention: every template's schema.ts exports `Schema` and `Example`.
// blank_scenegraph makes branding fully optional and explicitly FORBIDS
// the content block (z.never().optional() allows "key absent" but rejects
// any actual value).
const Hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

export const Schema = z
  .object({
    spec_version: z.literal(2),
    template: z.literal('blank_scenegraph'),
    modules: z.array(z.record(z.unknown())),
    app: z
      .object({
        name: z.string().min(1),
        major_version: z.number().int().min(0),
        minor_version: z.number().int().min(0),
        build_version: z.number().int().min(0),
      })
      .strict(),
    branding: z
      .object({
        primary_color: Hex.optional(),
        icon: z.string().min(1).optional(),
        splash: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    content: z.never().optional(),
  })
  .strict();

export const Example = {
  spec_version: 2 as const,
  template: 'blank_scenegraph' as const,
  modules: [],
  app: { name: 'Blank Channel', major_version: 0, minor_version: 1, build_version: 0 },
  // Intentionally no `branding` -- proves the zero-input synthesized path
  // works end-to-end.
};
