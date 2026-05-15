// pong-helpers.ts — verbatim TS translation of templates/game_shell/files/source/lib/pong.bs.
// Keep numeric constants in sync; pong-const-parity.test.ts asserts parity.

export const PONG_SCREEN_W = 1920;
export const PONG_SCREEN_H = 1080;
export const PONG_PADDLE_W = 20;
export const PONG_PADDLE_H = 140;
export const PONG_BALL_SIZE = 24;
export const PONG_PADDLE_SPEED_PX = 12;
export const PONG_BALL_VX_INITIAL = 9.0;
export const PONG_BALL_VY_INITIAL = 4.5;

export function pongStepCpu(currentPaddleY: number, ballY: number, lagPx: number): number {
  const targetCentre = ballY;
  const paddleCentre = currentPaddleY + PONG_PADDLE_H / 2;
  let delta = targetCentre - paddleCentre;
  if (Math.abs(delta) <= lagPx) return currentPaddleY;
  const maxDelta = PONG_PADDLE_SPEED_PX * 1.2;
  if (delta > maxDelta) delta = maxDelta;
  if (delta < -maxDelta) delta = -maxDelta;
  let newY = currentPaddleY + delta;
  if (newY < 0) newY = 0;
  const maxY = PONG_SCREEN_H - PONG_PADDLE_H;
  if (newY > maxY) newY = maxY;
  return newY;
}

export interface BallStepResult {
  ballX: number;
  ballY: number;
  vx: number;
  vy: number;
  scored: '' | 'player' | 'cpu';
}

export function pongStepBall(ballX: number, ballY: number, vx: number, vy: number): BallStepResult {
  const nx = ballX + vx;
  const ny = ballY + vy;
  let scored: '' | 'player' | 'cpu' = '';
  if (nx + PONG_BALL_SIZE < 0) scored = 'player';
  if (nx > PONG_SCREEN_W) scored = 'cpu';
  return { ballX: nx, ballY: ny, vx, vy, scored };
}

export interface PaddleCollideResult { vx: number; vy: number; }

export function pongCollidePaddle(
  ballX: number, ballY: number, vx: number, vy: number,
  paddleX: number, paddleY: number,
): PaddleCollideResult {
  if (ballX + PONG_BALL_SIZE < paddleX) return { vx, vy };
  if (ballX > paddleX + PONG_PADDLE_W) return { vx, vy };
  if (ballY + PONG_BALL_SIZE < paddleY) return { vx, vy };
  if (ballY > paddleY + PONG_PADDLE_H) return { vx, vy };
  const paddleCentreX = paddleX + PONG_PADDLE_W / 2;
  if (paddleCentreX < ballX && vx > 0) return { vx, vy };
  if (paddleCentreX > ballX && vx < 0) return { vx, vy };
  const ballCentreY = ballY + PONG_BALL_SIZE / 2;
  const paddleCentreY = paddleY + PONG_PADDLE_H / 2;
  const english = (ballCentreY - paddleCentreY) / (PONG_PADDLE_H / 2);
  return { vx: -vx, vy: vy + english * 3.0 };
}

export function pongCollideWall(ballY: number, vy: number, screenH: number): number {
  if (ballY <= 0 && vy < 0) return -vy;
  if (ballY + PONG_BALL_SIZE >= screenH && vy > 0) return -vy;
  return vy;
}

export function pongDifficultyToLagPx(difficulty: string): number {
  if (difficulty === 'easy') return 60;
  if (difficulty === 'hard') return 5;
  return 25;
}
