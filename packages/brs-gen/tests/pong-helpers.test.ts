import { describe, it, expect } from 'vitest';
import {
  pongStepCpu, pongStepBall, pongCollidePaddle, pongCollideWall, pongDifficultyToLagPx,
  PONG_PADDLE_SPEED_PX, PONG_PADDLE_H, PONG_SCREEN_H, PONG_BALL_SIZE,
} from './pong-helpers.js';

describe('pongDifficultyToLagPx', () => {
  it.each([['easy', 60], ['normal', 25], ['hard', 5], ['unknown', 25], ['', 25]] as const)(
    '%s -> %d', (d, expected) => { expect(pongDifficultyToLagPx(d)).toBe(expected); },
  );
});

describe('pongStepCpu', () => {
  it('does not move when ball is within lag tolerance', () => {
    expect(pongStepCpu(400, 470, 25)).toBe(400);  // paddleCentre=470, ballY=470, delta=0
  });
  it('moves toward ball when ball is below', () => {
    const r = pongStepCpu(400, 700, 25);  // delta=230 > maxDelta=14.4
    expect(r).toBe(400 + 14.4);
  });
  it('clamps to screen top', () => {
    expect(pongStepCpu(0, -1000, 5)).toBe(0);
  });
  it('clamps to screen bottom', () => {
    const maxY = PONG_SCREEN_H - PONG_PADDLE_H;
    expect(pongStepCpu(maxY, 9999, 5)).toBe(maxY);
  });
});

describe('pongStepBall', () => {
  it('advances by (vx, vy) and reports no score in middle of court', () => {
    const r = pongStepBall(960, 540, 9, 4.5);
    expect(r.ballX).toBe(969);
    expect(r.ballY).toBe(544.5);
    expect(r.scored).toBe('');
  });
  it('reports scored=player when ball passes left edge', () => {
    const r = pongStepBall(-PONG_BALL_SIZE, 540, -1, 0);
    expect(r.scored).toBe('player');
  });
  it('reports scored=cpu when ball passes right edge', () => {
    const r = pongStepBall(1920, 540, 1, 0);
    expect(r.scored).toBe('cpu');
  });
});

describe('pongCollidePaddle', () => {
  it('returns unchanged when no overlap', () => {
    const r = pongCollidePaddle(960, 540, -9, 0, 40, 470);
    expect(r).toEqual({ vx: -9, vy: 0 });
  });
  it('reflects vx when ball overlaps left paddle and is moving leftward', () => {
    const r = pongCollidePaddle(50, 540, -9, 0, 40, 470);
    expect(r.vx).toBe(9);
  });
  it('does NOT reflect when ball overlaps but is moving away (stick-collision guard)', () => {
    const r = pongCollidePaddle(55, 540, +5, 0, 40, 470);
    expect(r).toEqual({ vx: 5, vy: 0 });
  });
  it('adds positive english when ball hits below paddle centre', () => {
    const r = pongCollidePaddle(50, 580, -9, 0, 40, 470);
    expect(r.vy).toBeGreaterThan(0);
  });
});

describe('pongCollideWall', () => {
  it('flips vy on top wall hit', () => {
    expect(pongCollideWall(0, -3, PONG_SCREEN_H)).toBe(3);
  });
  it('flips vy on bottom wall hit', () => {
    expect(pongCollideWall(PONG_SCREEN_H - PONG_BALL_SIZE, 3, PONG_SCREEN_H)).toBe(-3);
  });
  it('returns vy unchanged when ball is in middle', () => {
    expect(pongCollideWall(540, 3, PONG_SCREEN_H)).toBe(3);
  });
  it('does not double-flip when ball already moving away from wall', () => {
    expect(pongCollideWall(0, 3, PONG_SCREEN_H)).toBe(3);
  });
});
