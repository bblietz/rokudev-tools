import { z } from 'zod';

const NonNegInt = z.number().int().min(0);

export const GameShellContentSchema = z
  .object({
    cpu_difficulty: z.enum(['easy', 'normal', 'hard']).default('normal'),
    score_to_win: z.number().int().min(1).max(21).default(5),
    high_score_persistence: z.boolean().default(true),
  })
  .strict();

export const Schema = z
  .object({
    spec_version: z.literal(2),
    template: z.literal('game_shell'),
    modules: z.array(z.object({ id: z.string(), config: z.unknown().optional() })).default([]),
    app: z
      .object({
        name: z.string().min(1).max(50),
        major_version: NonNegInt,
        minor_version: NonNegInt,
        build_version: NonNegInt,
      })
      .strict(),
    branding: z.object({}).passthrough().optional(),
    content: GameShellContentSchema.default({}),
  })
  .strict();

export const Example = {
  spec_version: 2 as const,
  template: 'game_shell' as const,
  modules: [],
  app: { name: 'Pong', major_version: 1, minor_version: 0, build_version: 0 },
  content: {
    cpu_difficulty: 'normal' as const,
    score_to_win: 5,
    high_score_persistence: true,
  },
};
