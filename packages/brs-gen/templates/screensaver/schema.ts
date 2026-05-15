import { z } from 'zod';

const NonNegInt = z.number().int().min(0);

export const ScreensaverContentSchema = z
  .object({
    feed_url: z.string().url().optional(),
    feed_format: z.literal('rokudev_screensaver_v1').default('rokudev_screensaver_v1'),
    transition_seconds: z.number().int().min(4).max(30).default(7),
    motion: z.enum(['ken_burns', 'crossfade_only', 'none']).default('ken_burns'),
  })
  .strict();

export const Schema = z
  .object({
    spec_version: z.literal(2),
    template: z.literal('screensaver'),
    modules: z.array(z.object({ id: z.string(), config: z.unknown().optional() })).default([]),
    app: z
      .object({
        name: z
          .string()
          .min(1)
          .max(50)
          .superRefine((v, ctx) => {
            if (/roku/i.test(v)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `screensaver_title cannot contain the word "Roku" per Roku Channel Store cert rules; spec.app.name was "${v}"`,
              });
            }
          }),
        major_version: NonNegInt,
        minor_version: NonNegInt,
        build_version: NonNegInt,
      })
      .strict(),
    branding: z.object({}).passthrough().optional(),
    content: ScreensaverContentSchema.optional(),
  })
  .strict();

export const Example = {
  spec_version: 2 as const,
  template: 'screensaver' as const,
  modules: [],
  app: { name: 'My Screensaver', major_version: 1, minor_version: 0, build_version: 0 },
  content: {
    feed_format: 'rokudev_screensaver_v1' as const,
    transition_seconds: 7,
    motion: 'ken_burns' as const,
  },
};
