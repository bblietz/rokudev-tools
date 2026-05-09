import { z } from 'zod';

const NonNegInt = z.number().int().min(0);

export const AppMeta = z
  .object({
    name: z.string().min(1),
    major_version: NonNegInt,
    minor_version: NonNegInt,
    build_version: NonNegInt,
  })
  .strict();

export const ModuleReference = z
  .object({
    id: z.string().min(1),
    version_range: z.string().optional(),
    config: z.record(z.unknown()).optional(),
  })
  .strict();
export type ModuleReference = z.infer<typeof ModuleReference>;

// Wrapper parses only the 4 wrapper fields. Per-template top-level fields
// (e.g. `branding` for a future video_grid_channel) are accepted via
// `.passthrough()` and validated by the template's bundled schema in a
// second parse pass (happens at tool-layer in T20's get_template_schema /
// T22's generate_app). Do NOT chain `.strict()` here; Zod's passthrough
// supersedes strict so the combination is only confusing.
export const AppSpecV2Wrapper = z
  .object({
    spec_version: z.literal(2),
    template: z.string().min(1),
    modules: z.array(ModuleReference),
    app: AppMeta,
  })
  .passthrough();

export const AppSpecV1Wrapper = z
  .object({
    spec_version: z.literal(1),
    template: z.string().min(1),
    app: AppMeta,
  })
  .passthrough();

export type AppSpecV2 = z.infer<typeof AppSpecV2Wrapper>;
export type AppSpecV1 = z.infer<typeof AppSpecV1Wrapper>;
