/**
 * game_shell engine threading tests (Task 1 of Plan 4f).
 *
 * These 4 test cases verify that cpu_difficulty, score_to_win, and
 * high_score_persistence are correctly threaded from AppSpec content fields
 * into source/_template/config.brs via emitTemplateConfigBs().
 *
 * Tests are expected to FAIL until Task 2 ships templates/game_shell/template.toml
 * and schema.ts. The expected failure mode is "template not found in catalog".
 *
 * Pattern mirrors the per-template describe blocks in snapshots.test.ts:
 * each case runs the full getGenerateAppHandler() pipeline (merger + compile)
 * in beforeAll, then asserts on config.brs content from the written project.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { setCatalogForTests } from '../src/tools/_catalog-singleton.js';
import { loadCatalog } from '../src/catalog/loader.js';
import { registerAllTools, type ToolDef } from '../src/tools/_register.js';
import '../src/tools/generate-app.js';

const PKG_ROOT = dirname(fileURLToPath(new URL('.', import.meta.url)));

function getGenerateAppHandler(): ToolDef['handler'] {
  const tools = new Map<string, ToolDef>();
  registerAllTools(tools);
  const def = tools.get('generate_app');
  if (!def) throw new Error('generate_app tool not registered');
  return def.handler;
}

// ---------------------------------------------------------------------------
// Case 1: bare spec (no content block) -> Zod defaults flow downstream
// Expects: cpu_difficulty="normal", score_to_win="5", high_score_persistence="true"
// ---------------------------------------------------------------------------
describe('game_shell template-config: bare spec (defaults)', () => {
  let parentDir: string;
  let projectDir: string;

  beforeAll(async () => {
    const cat = await loadCatalog(PKG_ROOT);
    setCatalogForTests(cat);

    parentDir = await mkdtemp(join(tmpdir(), 'brs-gen-game-bare-'));
    projectDir = join(parentDir, 'project');

    const handler = getGenerateAppHandler();
    const result = await handler({
      spec: {
        spec_version: 2,
        template: 'game_shell',
        modules: [],
        app: { name: 'Pong E2E', major_version: 0, minor_version: 1, build_version: 0 },
        // No content block: Zod defaults apply.
      },
      output_dir: projectDir,
    });
    const payload = result as Record<string, unknown>;
    if (!payload['ok']) {
      throw new Error(`generate_app failed in beforeAll: ${JSON.stringify(payload)}`);
    }
  }, 30_000);

  afterAll(async () => {
    if (parentDir) await rm(parentDir, { recursive: true, force: true });
  });

  it('config.brs contains cpu_difficulty="normal" (Zod default)', async () => {
    const s = await readFile(join(projectDir, 'source/_template/config.brs'), 'utf8');
    expect(s).toContain('"cpu_difficulty": "normal"');
  });

  it('config.brs contains score_to_win="5" (Zod default)', async () => {
    const s = await readFile(join(projectDir, 'source/_template/config.brs'), 'utf8');
    expect(s).toContain('"score_to_win": "5"');
  });

  it('config.brs contains high_score_persistence="true" (Zod default)', async () => {
    const s = await readFile(join(projectDir, 'source/_template/config.brs'), 'utf8');
    expect(s).toContain('"high_score_persistence": "true"');
  });
});

// ---------------------------------------------------------------------------
// Case 2: content.cpu_difficulty='hard' -> emits "cpu_difficulty": "hard"
// ---------------------------------------------------------------------------
describe('game_shell template-config: cpu_difficulty=hard', () => {
  let parentDir: string;
  let projectDir: string;

  beforeAll(async () => {
    const cat = await loadCatalog(PKG_ROOT);
    setCatalogForTests(cat);

    parentDir = await mkdtemp(join(tmpdir(), 'brs-gen-game-hard-'));
    projectDir = join(parentDir, 'project');

    const handler = getGenerateAppHandler();
    const result = await handler({
      spec: {
        spec_version: 2,
        template: 'game_shell',
        modules: [],
        app: { name: 'Pong Hard', major_version: 0, minor_version: 1, build_version: 0 },
        content: {
          cpu_difficulty: 'hard',
        },
      },
      output_dir: projectDir,
    });
    const payload = result as Record<string, unknown>;
    if (!payload['ok']) {
      throw new Error(`generate_app failed in beforeAll: ${JSON.stringify(payload)}`);
    }
  }, 30_000);

  afterAll(async () => {
    if (parentDir) await rm(parentDir, { recursive: true, force: true });
  });

  it('config.brs contains cpu_difficulty="hard"', async () => {
    const s = await readFile(join(projectDir, 'source/_template/config.brs'), 'utf8');
    expect(s).toContain('"cpu_difficulty": "hard"');
  });
});

// ---------------------------------------------------------------------------
// Case 3: content.score_to_win=10 -> emits "score_to_win": "10"
// ---------------------------------------------------------------------------
describe('game_shell template-config: score_to_win=10', () => {
  let parentDir: string;
  let projectDir: string;

  beforeAll(async () => {
    const cat = await loadCatalog(PKG_ROOT);
    setCatalogForTests(cat);

    parentDir = await mkdtemp(join(tmpdir(), 'brs-gen-game-10-'));
    projectDir = join(parentDir, 'project');

    const handler = getGenerateAppHandler();
    const result = await handler({
      spec: {
        spec_version: 2,
        template: 'game_shell',
        modules: [],
        app: { name: 'Pong 10', major_version: 0, minor_version: 1, build_version: 0 },
        content: {
          score_to_win: 10,
        },
      },
      output_dir: projectDir,
    });
    const payload = result as Record<string, unknown>;
    if (!payload['ok']) {
      throw new Error(`generate_app failed in beforeAll: ${JSON.stringify(payload)}`);
    }
  }, 30_000);

  afterAll(async () => {
    if (parentDir) await rm(parentDir, { recursive: true, force: true });
  });

  it('config.brs contains score_to_win="10"', async () => {
    const s = await readFile(join(projectDir, 'source/_template/config.brs'), 'utf8');
    expect(s).toContain('"score_to_win": "10"');
  });
});

// ---------------------------------------------------------------------------
// Case 4: content.high_score_persistence=false -> emits "high_score_persistence": "false"
// ---------------------------------------------------------------------------
describe('game_shell template-config: high_score_persistence=false', () => {
  let parentDir: string;
  let projectDir: string;

  beforeAll(async () => {
    const cat = await loadCatalog(PKG_ROOT);
    setCatalogForTests(cat);

    parentDir = await mkdtemp(join(tmpdir(), 'brs-gen-game-kiosk-'));
    projectDir = join(parentDir, 'project');

    const handler = getGenerateAppHandler();
    const result = await handler({
      spec: {
        spec_version: 2,
        template: 'game_shell',
        modules: [],
        app: { name: 'Pong Kiosk', major_version: 0, minor_version: 1, build_version: 0 },
        content: {
          high_score_persistence: false,
        },
      },
      output_dir: projectDir,
    });
    const payload = result as Record<string, unknown>;
    if (!payload['ok']) {
      throw new Error(`generate_app failed in beforeAll: ${JSON.stringify(payload)}`);
    }
  }, 30_000);

  afterAll(async () => {
    if (parentDir) await rm(parentDir, { recursive: true, force: true });
  });

  it('config.brs contains high_score_persistence="false"', async () => {
    const s = await readFile(join(projectDir, 'source/_template/config.brs'), 'utf8');
    expect(s).toContain('"high_score_persistence": "false"');
  });
});
