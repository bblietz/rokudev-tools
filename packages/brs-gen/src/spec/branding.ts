import { z } from 'zod';

/**
 * Optional branding block. All three fields are optional at this layer; a
 * template may tighten the required set via `.required()` in its own
 * schema.ts (see templates/video_grid_channel/schema.ts).
 */
export const BrandingSchema = z
  .object({
    primary_color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/, 'primary_color must match #RRGGBB')
      .optional(),
    icon: z.string().min(1).optional(),
    splash: z.string().min(1).optional(),
  })
  .strict();

export type Branding = z.infer<typeof BrandingSchema>;
