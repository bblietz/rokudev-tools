// packages/brs-gen/templates/stub_hello/schema.ts
import { z } from 'zod';

// Convention: every template's schema.ts exports exactly two names,
// `Schema` and `Example`. The get_template_schema MCP tool (T20) imports by
// these exact names; do NOT rename without updating that tool too.

// stub_hello accepts AppSpec v1 or v2 wrapper with no extra fields.
export const Schema = z
  .object({
    spec_version: z.union([z.literal(1), z.literal(2)]),
    template: z.literal('stub_hello'),
    modules: z.array(z.record(z.unknown())).optional(), // v2 only
    app: z
      .object({
        name: z.string().min(1),
        major_version: z.number().int().min(0),
        minor_version: z.number().int().min(0),
        build_version: z.number().int().min(0),
      })
      .strict(),
  })
  .strict();

export const Example = {
  spec_version: 2 as const,
  template: 'stub_hello' as const,
  modules: [],
  app: { name: 'Stub Channel', major_version: 1, minor_version: 0, build_version: 0 },
};
