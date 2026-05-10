// packages/brs-gen/templates/video_grid_channel/schema.ts
import { z } from 'zod';

// Convention: every template's schema.ts exports `Schema` and `Example`.
// video_grid_channel requires branding + content, both with their concrete
// fields present.
const Hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

export const Schema = z
  .object({
    spec_version: z.literal(2),
    template: z.literal('video_grid_channel'),
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
        primary_color: Hex,
        icon: z.string().min(1),
        splash: z.string().min(1),
      })
      .strict(),
    content: z
      .object({
        feed_url: z.string().url(),
        feed_format: z.literal('roku_direct_publisher_json'),
      })
      .strict(),
  })
  .strict();

export const Example = {
  spec_version: 2 as const,
  template: 'video_grid_channel' as const,
  modules: [],
  app: { name: 'Acme TV', major_version: 0, minor_version: 1, build_version: 0 },
  branding: {
    primary_color: '#E50914',
    icon: './assets/icon.png',
    splash: './assets/splash.png',
  },
  content: {
    // Pinned 2026-05-10; AVideo demo platform public RDP JSON sample.
    // If this 404s in the future, fix-forward per PRD §D4/D12 (update here +
    // scripts/t27-video-grid.mjs + docs/superpowers/specs/2026-05-09-plan-4-*).
    feed_url: 'https://demo.avideo.com/roku.json',
    feed_format: 'roku_direct_publisher_json' as const,
  },
};
