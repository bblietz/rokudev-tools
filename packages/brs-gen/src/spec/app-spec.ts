import { z } from 'zod';
import { BrandingSchema } from './branding.js';
import { ContentSchema } from './content.js';

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

// Wrapper names every field it knows about; unknown fields still pass
// through (via .passthrough()) so template-strict schemas get to see them.
// branding / content are optional at the wrapper level; templates make
// them required in their own strict schema (see templates/<id>/schema.ts).
export const AppSpecV2Wrapper = z
  .object({
    spec_version: z.literal(2),
    template: z.string().min(1),
    modules: z.array(ModuleReference),
    app: AppMeta,
    branding: BrandingSchema.optional(),
    content: ContentSchema.optional(),
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
