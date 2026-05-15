import { describe, it, expect } from 'vitest';
import { Schema as GameShellSpecSchema } from '../templates/game_shell/schema.js';

const baseApp = { name: 'Pong', major_version: 0, minor_version: 1, build_version: 0 };
const baseSpec = { spec_version: 2, template: 'game_shell' as const, modules: [], app: baseApp };

describe('GameShellSpecSchema', () => {
  it('accepts bare spec (no content) and applies defaults', () => {
    const r = GameShellSpecSchema.safeParse(baseSpec);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.content.cpu_difficulty).toBe('normal');
      expect(r.data.content.score_to_win).toBe(5);
      expect(r.data.content.high_score_persistence).toBe(true);
    }
  });

  it.each(['easy', 'normal', 'hard'] as const)('accepts cpu_difficulty=%s', (d) => {
    const r = GameShellSpecSchema.safeParse({ ...baseSpec, content: { cpu_difficulty: d } });
    expect(r.success).toBe(true);
  });

  it('rejects cpu_difficulty=insane', () => {
    const r = GameShellSpecSchema.safeParse({ ...baseSpec, content: { cpu_difficulty: 'insane' } });
    expect(r.success).toBe(false);
  });

  it.each([1, 5, 21])('accepts score_to_win=%d', (n) => {
    const r = GameShellSpecSchema.safeParse({ ...baseSpec, content: { score_to_win: n } });
    expect(r.success).toBe(true);
  });

  it.each([0, 22, -1, 1.5])('rejects score_to_win=%s', (n) => {
    const r = GameShellSpecSchema.safeParse({ ...baseSpec, content: { score_to_win: n } });
    expect(r.success).toBe(false);
  });

  it('accepts high_score_persistence=false', () => {
    const r = GameShellSpecSchema.safeParse({ ...baseSpec, content: { high_score_persistence: false } });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.content.high_score_persistence).toBe(false);
  });

  it('rejects unknown content fields (strict)', () => {
    const r = GameShellSpecSchema.safeParse({ ...baseSpec, content: { not_a_real_field: 'x' } });
    expect(r.success).toBe(false);
  });

  it('rejects unknown top-level fields (strict)', () => {
    const r = GameShellSpecSchema.safeParse({ ...baseSpec, surprise: 'x' });
    expect(r.success).toBe(false);
  });
});
