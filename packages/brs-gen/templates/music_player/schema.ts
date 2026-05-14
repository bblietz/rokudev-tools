// packages/brs-gen/templates/music_player/schema.ts
import { z } from 'zod';

const NonNegInt = z.number().int().min(0);
const Hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

// music_player-specific content block. feed_url / feed_format are optional;
// when absent the template uses the bundled music-feed.json. service_name is
// the "FROM <name>" header line on NowPlayingScene (default = spec.app.name,
// resolved at runtime). Capped at 20 chars because the header band is small;
// longer strings overflow.
const MusicContentSchema = z
  .object({
    feed_url: z.string().url().optional(),
    feed_format: z.enum(['music_player_json']).optional(),
    service_name: z.string().min(1).max(20).optional(),
  })
  .strict();

export const Schema = z
  .object({
    spec_version: z.literal(2),
    template: z.literal('music_player'),
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
    content: MusicContentSchema.optional(),
  })
  .strict();

export const Example = {
  spec_version: 2 as const,
  template: 'music_player' as const,
  modules: [],
  app: { name: 'Music Demo', major_version: 0, minor_version: 1, build_version: 0 },
  content: { service_name: 'Music Demo' },
};
