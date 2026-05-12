// packages/brs-gen/templates/news_channel/schema.ts
import { z } from 'zod';

const NonNegInt = z.number().int().min(0);
const Hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

// news_channel-specific content block. feed_url / feed_format are optional;
// when absent the template uses the bundled news-feed.json. live_label is the
// LIVE-badge text (default "LIVE", applied at runtime in LiveHero.bs). Capped
// at 12 chars because the badge layout is small; longer strings overflow.
const NewsContentSchema = z
  .object({
    feed_url: z.string().url().optional(),
    feed_format: z.enum(['roku_direct_publisher_json']).optional(),
    live_label: z.string().min(1).max(12).optional(),
  })
  .strict();

export const Schema = z
  .object({
    spec_version: z.literal(2),
    template: z.literal('news_channel'),
    modules: z.array(z.record(z.unknown())),
    app: z
      .object({
        name: z.string().min(1),
        major_version: NonNegInt,
        minor_version: NonNegInt,
        build_version: NonNegInt,
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
    content: NewsContentSchema.optional(),
  })
  .strict();

export const Example = {
  spec_version: 2 as const,
  template: 'news_channel' as const,
  modules: [],
  app: { name: 'News Channel Demo', major_version: 0, minor_version: 1, build_version: 0 },
};
