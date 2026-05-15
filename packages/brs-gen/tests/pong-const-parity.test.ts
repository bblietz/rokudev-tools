import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as shim from './pong-helpers.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PONG_BS = join(HERE, '../templates/game_shell/files/source/lib/pong.bs');

const PARITY: Array<[string, keyof typeof shim, number]> = [
  ['PONG_SCREEN_W%', 'PONG_SCREEN_W', 1920],
  ['PONG_SCREEN_H%', 'PONG_SCREEN_H', 1080],
  ['PONG_PADDLE_W%', 'PONG_PADDLE_W', 20],
  ['PONG_PADDLE_H%', 'PONG_PADDLE_H', 140],
  ['PONG_BALL_SIZE%', 'PONG_BALL_SIZE', 24],
  ['PONG_PADDLE_SPEED_PX%', 'PONG_PADDLE_SPEED_PX', 12],
  ['PONG_BALL_VX_INITIAL!', 'PONG_BALL_VX_INITIAL', 9.0],
  ['PONG_BALL_VY_INITIAL!', 'PONG_BALL_VY_INITIAL', 4.5],
];

describe('pong.bs <-> pong-helpers.ts const parity', () => {
  const src = readFileSync(PONG_BS, 'utf8');

  for (const [bsName, tsName, expectedValue] of PARITY) {
    it(`${bsName} === shim.${String(tsName)} === ${expectedValue}`, () => {
      const escaped = bsName.replace(/[%!]/g, '\\$&');
      const re = new RegExp(`const\\s+${escaped}\\s*=\\s*([0-9.\\-]+)`, 'm');
      const m = src.match(re);
      expect(m, `BS const ${bsName} not found in pong.bs`).toBeTruthy();
      const bsValue = parseFloat(m![1]);
      const tsValue = shim[tsName];
      expect(bsValue).toBe(expectedValue);
      expect(tsValue).toBe(expectedValue);
    });
  }
});
