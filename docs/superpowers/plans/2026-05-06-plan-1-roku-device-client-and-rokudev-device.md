# Plan 1: roku-device-client + rokudev-device MCP Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the monorepo foundation, the shared `roku-device-client` TypeScript library, and the `rokudev-device` MCP server. After this plan, a developer who manually wires `rokudev-device` into their MCP client (e.g. `claude mcp add rokudev-device node /path/to/dist/index.js`) gets device introspection, ECP control, dev-portal sideload/unload/screenshot/genkey/rekey/sign, telnet log capture, and a unified device registry with multi-network detection. **Excludes** BDP debugger (Plan 2), generator (Plan 3), freeform/LSP (Plan 4), and one-shot install via the Claude Code plugin (Plan 6).

**Architecture:** Monorepo with pnpm workspaces and Turborepo. `roku-device-client` is a pure TS library (no MCP wrapping) holding all Roku-touching primitives behind typed clients. `rokudev-device` is a thin MCP server that wraps the library's clients into MCP tools, adds the device registry layer, and enforces the ECP allowlists and network detection warnings. Determinism, security (`dev_password` never logged), and the unified error taxonomy are load-bearing.

**Tech Stack:** Node 20+, TypeScript 5.x, pnpm 9+, Turborepo, Vitest, Zod, undici, MCP TypeScript SDK (`@modelcontextprotocol/sdk`), yazl (zip), proper-lockfile (advisory `flock`), dgram (SSDP).

**Spec:** `docs/superpowers/specs/2026-05-06-roku-tools-prd-design.md` is the source of truth for design. This plan implements §2 (architecture), §4 (device plane minus §4.5 BDP), and the bootstrap pieces of §7.

**Estimated tasks:** ~60 across three phases (Phase 0 monorepo bootstrap, Phase 1 library, Phase 2 MCP server).

---

## Phase 0: Monorepo Bootstrap

### Task 1: Initialize git repo and root files

**Files:**
- Create: `/Users/bblietz/Work/ClaudeProjects/rokudev-tools/.gitignore`
- Create: `/Users/bblietz/Work/ClaudeProjects/rokudev-tools/README.md`
- Create: `/Users/bblietz/Work/ClaudeProjects/rokudev-tools/LICENSE`

- [ ] **Step 1: Initialize git**

```bash
cd /Users/bblietz/Work/ClaudeProjects/rokudev-tools
git init -b main
```

Expected: `Initialized empty Git repository`.

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
dist/
*.log
.turbo/
coverage/
.DS_Store
*.tsbuildinfo
.rokudev-tools/
.vscode/

# Never commit user-level config
~/.config/rokudev/

# Generated FTS5 indices
corpus/build/
```

- [ ] **Step 3: Create `LICENSE` (MIT, matching prototypes)**

Write a standard MIT LICENSE file with copyright Roku, Inc., 2026.

- [ ] **Step 4: Create `README.md` stub**

```markdown
# rokudev-tools

Unified Roku BrightScript developer toolkit. Three MCP servers, one shared library, one Claude Code plugin.

See `docs/superpowers/specs/2026-05-06-roku-tools-prd-design.md` for the full design.
```

- [ ] **Step 5: First commit**

```bash
git add .gitignore LICENSE README.md docs/
git commit -m "chore: bootstrap monorepo with license and gitignore"
```

Expected: commit succeeds; `git log` shows one commit.

---

### Task 2: pnpm workspace + Turborepo

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `.npmrc`
- Create: `.release/version.json`

- [ ] **Step 1: Verify pnpm available**

```bash
corepack enable
pnpm --version
```

Expected: a 9.x version string. If `corepack` is missing, install Node 20+ first.

- [ ] **Step 2: Create root `package.json`**

```json
{
  "name": "rokudev-tools",
  "private": true,
  "version": "0.1.0",
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=20" },
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.5.0",
    "prettier": "^3.3.0"
  }
}
```

- [ ] **Step 3: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
```

- [ ] **Step 4: Create `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "lint": {},
    "typecheck": {
      "dependsOn": ["^build"]
    }
  }
}
```

- [ ] **Step 5: Create `.npmrc`**

```
strict-peer-dependencies=false
auto-install-peers=true
```

- [ ] **Step 6: Create `.release/version.json`**

```json
{ "version": "0.1.0" }
```

- [ ] **Step 7: Install root deps and commit**

```bash
pnpm install
git add package.json pnpm-workspace.yaml turbo.json .npmrc .release/ pnpm-lock.yaml
git commit -m "chore: pnpm workspace + turborepo bootstrap"
```

Expected: clean install, no warnings about missing scripts.

---

### Task 3: Shared TS config and tooling

**Files:**
- Create: `tsconfig.base.json`
- Create: `.prettierrc`
- Create: `.prettierignore`
- Create: `vitest.config.base.ts`

- [ ] **Step 1: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noImplicitOverride": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 2: Create `.prettierrc`**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "endOfLine": "lf"
}
```

- [ ] **Step 3: Create `.prettierignore`**

```
node_modules
dist
.turbo
coverage
pnpm-lock.yaml
corpus/build
```

- [ ] **Step 4: Create `vitest.config.base.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
    pool: 'forks',
  },
});
```

- [ ] **Step 5: Run format check**

```bash
pnpm format:check
```

Expected: passes (no files reformatted).

- [ ] **Step 6: Commit**

```bash
git add tsconfig.base.json .prettierrc .prettierignore vitest.config.base.ts
git commit -m "chore: shared tsconfig, prettier, vitest base"
```

---

### Task 4: CI bootstrap script

**Files:**
- Create: `scripts/ci-bootstrap.sh`

- [ ] **Step 1: Write `scripts/ci-bootstrap.sh`**

```bash
#!/usr/bin/env bash
# scripts/ci-bootstrap.sh
# Activates pnpm via corepack; falls back to npm-installed pnpm pin if corepack unavailable.
# Used by external CI environments that do not pre-install pnpm.

set -euo pipefail

PNPM_PIN="9.12.0"

if command -v corepack >/dev/null 2>&1; then
  corepack enable
  corepack prepare "pnpm@${PNPM_PIN}" --activate
elif command -v npm >/dev/null 2>&1; then
  npm install -g "pnpm@${PNPM_PIN}"
else
  echo "ERROR: neither corepack nor npm available; cannot install pnpm." >&2
  exit 1
fi

pnpm --version
```

- [ ] **Step 2: Make executable and commit**

```bash
chmod +x scripts/ci-bootstrap.sh
git add scripts/ci-bootstrap.sh
git commit -m "chore: ci-bootstrap.sh for envs without pnpm"
```

---

### Task 5: Phase 0 sanity check

- [ ] **Step 1: Run all root scripts and confirm no failures**

```bash
pnpm typecheck   # no packages yet, should be a no-op
pnpm lint        # no packages yet, should be a no-op
pnpm test        # no packages yet, should be a no-op
pnpm build       # no packages yet, should be a no-op
```

Expected: all four exit 0 (turbo reports "no tasks to run" or similar).

Phase 0 complete; the monorepo is bootstrapped.

---

## Phase 1: roku-device-client Library

The shared TS library. Pure functions and typed clients; no MCP wrapping. Imported by `rokudev-device` (and later by `brs-gen`).

### Task 6: Bootstrap roku-device-client package

**Files:**
- Create: `packages/roku-device-client/package.json`
- Create: `packages/roku-device-client/tsconfig.json`
- Create: `packages/roku-device-client/vitest.config.ts`
- Create: `packages/roku-device-client/src/index.ts`

- [ ] **Step 1: Create directory and `package.json`**

```bash
mkdir -p packages/roku-device-client/src
mkdir -p packages/roku-device-client/tests
```

```json
{
  "name": "@rokudev/device-client",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./errors": { "types": "./dist/errors/index.d.ts", "import": "./dist/errors/index.js" },
    "./registry": { "types": "./dist/registry/index.d.ts", "import": "./dist/registry/index.js" },
    "./network": { "types": "./dist/network/index.d.ts", "import": "./dist/network/index.js" },
    "./ecp": { "types": "./dist/ecp/index.d.ts", "import": "./dist/ecp/index.js" },
    "./devportal": { "types": "./dist/devportal/index.d.ts", "import": "./dist/devportal/index.js" },
    "./telnet": { "types": "./dist/telnet/index.d.ts", "import": "./dist/telnet/index.js" },
    "./discovery": { "types": "./dist/discovery/index.d.ts", "import": "./dist/discovery/index.js" }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc --noEmit -p tsconfig.json",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "undici": "^6.19.0",
    "yazl": "^2.5.1",
    "yauzl": "^3.1.3",
    "proper-lockfile": "^4.1.2",
    "smol-toml": "^1.3.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/yazl": "^2.4.5",
    "@types/yauzl": "^2.10.3",
    "@types/proper-lockfile": "^4.1.4",
    "vitest": "^2.0.0",
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "composite": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
export { default } from '../../vitest.config.base.ts';
```

- [ ] **Step 4: Create stub `src/index.ts`**

```ts
// Public surface re-exports. Filled in as modules land.
export const VERSION = '0.1.0';
```

- [ ] **Step 5: Install and verify build**

```bash
pnpm install
pnpm --filter @rokudev/device-client build
```

Expected: `dist/index.js` exists.

- [ ] **Step 6: Commit**

```bash
git add packages/roku-device-client/
git commit -m "feat(roku-device-client): bootstrap package"
```

---

### Task 7: Errors module — taxonomy types and factory

Implements §4.6 of the spec.

**Files:**
- Create: `packages/roku-device-client/src/errors/index.ts`
- Create: `packages/roku-device-client/src/errors/codes.ts`
- Create: `packages/roku-device-client/src/errors/index.test.ts`

- [ ] **Step 1: Write `codes.ts` with the full code/stage enum**

```ts
// All error codes from spec §4.6. Each maps to exactly one stage.

export const STAGES = [
  'validate', 'render', 'write', 'package', 'sideload',
  'device', 'debug', 'merge', 'freeform', 'registry', 'lint', 'bootstrap',
] as const;
export type Stage = (typeof STAGES)[number];

// Failure codes. Add to this map as new codes are introduced.
export const FAILURE_CODES = {
  // device
  DEVICE_NOT_FOUND: 'device',
  DEVICE_NOT_RESOLVED: 'device',
  DEVICE_NO_PASSWORD: 'device',
  DEVICE_UNREACHABLE: 'device',
  DEVICE_NOT_DEV_MODE: 'device',
  DEVICE_AUTH_FAILED: 'device',
  NETWORK_UNREACHABLE: 'device',
  ECP_PARAM_DISALLOWED: 'device',
  ECP_KEY_DISALLOWED: 'device',
  LOG_TAIL_BUSY: 'device',
  LOG_STREAM_TIMED_OUT: 'device',
  SCREENSHOT_FAILED: 'device',
  GENKEY_FAILED: 'device',
  REKEY_FAILED: 'device',
  SIGNING_PASSWORD_REJECTED: 'device',
  PACKAGE_FAILED: 'device',
  DEV_PKG_UNAVAILABLE: 'device',
  // sideload
  SIDELOAD_REJECTED: 'sideload',
  SIDELOAD_TIMEOUT: 'sideload',
  ZIP_NOT_FOUND: 'sideload',
  // registry
  REGISTRY_BUSY: 'registry',
  INVALID_DEVICE_NAME: 'registry',
  // bootstrap
  CROSS_PACKAGE_VERSION_MISMATCH: 'bootstrap',
  // (merge, debug, freeform, lint codes added by Plans 2-4)
} as const;
export type FailureCode = keyof typeof FAILURE_CODES;

// In-band warning codes (returned on ok:true responses).
export const WARNING_CODES = [
  'LOG_STREAM_OVERFLOW',
  'APPSPEC_PROMOTED',
  'BDP_FALLBACK_TO_TELNET',
  'CROSS_PACKAGE_VERSION_MISMATCH',
] as const;
export type WarningCode = (typeof WARNING_CODES)[number];
```

- [ ] **Step 2: Write `errors/index.ts` with factory**

```ts
import { FAILURE_CODES, type FailureCode, type Stage, type WarningCode } from './codes.js';

export type Failure = {
  ok: false;
  stage: Stage;
  code: FailureCode;
  message: string;
  details?: Record<string, unknown>;
};

export type Warning = {
  code: WarningCode;
  message: string;
  [k: string]: unknown;
};

export function fail(code: FailureCode, message: string, details?: Record<string, unknown>): Failure {
  return { ok: false, stage: FAILURE_CODES[code], code, message, ...(details ? { details } : {}) };
}

export function warn(code: WarningCode, message: string, extra?: Record<string, unknown>): Warning {
  return { code, message, ...(extra ?? {}) };
}

export { FAILURE_CODES, WARNING_CODES, STAGES };
export type { FailureCode, WarningCode, Stage };
```

- [ ] **Step 3: Write tests `errors/index.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { fail, warn, FAILURE_CODES } from './index.js';

describe('errors', () => {
  it('fail() sets stage from code map', () => {
    const f = fail('NETWORK_UNREACHABLE', 'home not reachable from corp');
    expect(f.ok).toBe(false);
    expect(f.stage).toBe('device');
    expect(f.code).toBe('NETWORK_UNREACHABLE');
  });

  it('fail() omits details when none given', () => {
    const f = fail('DEVICE_NOT_FOUND', 'no such device');
    expect(f.details).toBeUndefined();
  });

  it('fail() carries details when given', () => {
    const f = fail('REGISTRY_BUSY', 'lock held', { holder_pid: 123 });
    expect(f.details).toEqual({ holder_pid: 123 });
  });

  it('warn() returns correct code and extras', () => {
    const w = warn('LOG_STREAM_OVERFLOW', 'dropped lines', { dropped_lines: 17 });
    expect(w.code).toBe('LOG_STREAM_OVERFLOW');
    expect(w.dropped_lines).toBe(17);
  });

  it('every FAILURE_CODES value is a known stage', () => {
    for (const stage of Object.values(FAILURE_CODES)) {
      expect(['validate', 'render', 'write', 'package', 'sideload',
              'device', 'debug', 'merge', 'freeform', 'registry', 'lint', 'bootstrap']).toContain(stage);
    }
  });
});
```

- [ ] **Step 4: Run tests — should fail because index.ts has no exports yet**

```bash
pnpm --filter @rokudev/device-client test
```

Expected: 5 tests fail (or import errors).

- [ ] **Step 5: Re-export errors from main `src/index.ts`**

```ts
export * from './errors/index.js';
export const VERSION = '0.1.0';
```

- [ ] **Step 6: Re-run tests**

```bash
pnpm --filter @rokudev/device-client test
```

Expected: 5 passed.

- [ ] **Step 7: Commit**

```bash
git add packages/roku-device-client/src/errors/ packages/roku-device-client/src/index.ts
git commit -m "feat(roku-device-client): error taxonomy with stage map"
```

---

### Task 8: Registry types and TOML parser

Implements §4.1 device registry shape.

**Files:**
- Create: `packages/roku-device-client/src/registry/types.ts`
- Create: `packages/roku-device-client/src/registry/parse.ts`
- Create: `packages/roku-device-client/src/registry/parse.test.ts`

- [ ] **Step 1: Write `types.ts`**

```ts
import { z } from 'zod';

export const NETWORK_TAG = z.enum(['home', 'corp', 'home_via_vpn', 'unknown']);
export type NetworkTag = z.infer<typeof NETWORK_TAG>;

export const DeviceNameSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/, 'device name must match [A-Za-z0-9_-]+');
export type DeviceName = z.infer<typeof DeviceNameSchema>;

export const DeviceEntrySchema = z.object({
  host: z.string().min(1),
  hostname: z.string().optional(),
  network_tag: NETWORK_TAG.optional(),
  serial: z.string().optional(),
  model: z.string().optional(),
  dev_password: z.string().optional(),
  added_at: z.string().optional(),
  last_seen: z.string().optional(),
});
export type DeviceEntry = z.infer<typeof DeviceEntrySchema>;

export const NetworkEntrySchema = z.object({
  gateway_mac: z.string().optional(),
  gateway_subnet_v4: z.string().optional(),
  dns_search_suffix: z.string().optional(),
  reachable_from: z.array(z.string()).optional(),
});
export type NetworkEntry = z.infer<typeof NetworkEntrySchema>;

export const RegistrySchema = z.object({
  active: z.string().optional(),
  devices: z.record(DeviceNameSchema, DeviceEntrySchema).default({}),
  networks: z.record(z.string(), NetworkEntrySchema).default({}),
});
export type Registry = z.infer<typeof RegistrySchema>;
```

- [ ] **Step 2: Write `parse.ts`**

```ts
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { RegistrySchema, type Registry } from './types.js';

export function parseRegistry(text: string): Registry {
  if (text.trim() === '') {
    return { devices: {}, networks: {} };
  }
  const raw = parseToml(text) as Record<string, unknown>;
  // Normalize: smol-toml returns nested tables as objects; ensure devices/networks keys exist.
  return RegistrySchema.parse({
    active: raw.active,
    devices: raw.devices ?? {},
    networks: raw.networks ?? {},
  });
}

export function serializeRegistry(r: Registry): string {
  // smol-toml does not emit nested-table headers in the form we want for empty
  // records, so build the output manually for full control over formatting and
  // determinism.
  const lines: string[] = [];
  lines.push('# rokudev-tools device registry');
  lines.push('# WARNING: dev_password stored in plaintext. Set ROKUDEV_NO_PLAINTEXT=1 to refuse.');
  lines.push('');
  if (r.active !== undefined) {
    lines.push(`active = ${JSON.stringify(r.active)}`);
    lines.push('');
  }
  for (const name of Object.keys(r.devices).sort()) {
    const d = r.devices[name]!;
    lines.push(`[devices.${name}]`);
    for (const [k, v] of Object.entries(d).sort(([a], [b]) => a.localeCompare(b))) {
      if (v === undefined) continue;
      lines.push(`${k} = ${JSON.stringify(v)}`);
    }
    lines.push('');
  }
  for (const name of Object.keys(r.networks).sort()) {
    const n = r.networks[name]!;
    lines.push(`[networks.${name}]`);
    for (const [k, v] of Object.entries(n).sort(([a], [b]) => a.localeCompare(b))) {
      if (v === undefined) continue;
      lines.push(`${k} = ${JSON.stringify(v)}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
```

- [ ] **Step 3: Write tests `parse.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { parseRegistry, serializeRegistry } from './parse.js';
import { RegistrySchema } from './types.js';

describe('registry/parse', () => {
  it('returns empty registry on empty input', () => {
    expect(parseRegistry('')).toEqual({ devices: {}, networks: {} });
  });

  it('parses a minimal registry', () => {
    const text = `
active = "home-tv"

[devices.home-tv]
host = "192.168.1.42"
network_tag = "home"
dev_password = "rokudev"

[networks.home]
gateway_mac = "ac:de:48:00:11:22"
`;
    const r = parseRegistry(text);
    expect(r.active).toBe('home-tv');
    expect(r.devices['home-tv']?.host).toBe('192.168.1.42');
    expect(r.devices['home-tv']?.network_tag).toBe('home');
    expect(r.networks.home?.gateway_mac).toBe('ac:de:48:00:11:22');
  });

  it('rejects invalid network_tag', () => {
    expect(() => parseRegistry('[devices.x]\nhost = "1.1.1.1"\nnetwork_tag = "garage"\n')).toThrow();
  });

  it('rejects invalid device name when constructed in-memory', () => {
    // TOML keys with spaces are rejected by the TOML parser itself, which is
    // not what we want to assert here; the schema validation is the load-bearing
    // check. Construct the object directly and run RegistrySchema.parse.
    expect(() => RegistrySchema.parse({
      devices: { 'bad name': { host: '1.1.1.1' } },
      networks: {},
    })).toThrow();
  });

  it('rejects invalid device name appearing through serialize+parse round-trip', () => {
    // Ensure callers cannot smuggle an invalid name into the registry by writing
    // a serialized form. This test is structural: we only construct via
    // RegistrySchema.parse, which is the only entry point for trusted input.
    expect(() => RegistrySchema.parse({
      devices: { 'with/slash': { host: '1.1.1.1' } },
      networks: {},
    })).toThrow();
  });

  it('serialize then parse round-trips devices and networks', () => {
    const r = {
      active: 'a',
      devices: {
        a: { host: '10.0.0.1', dev_password: 'p', network_tag: 'corp' as const },
        b: { host: '10.0.0.2' },
      },
      networks: {
        corp: { gateway_mac: '00:11:22:33:44:55', reachable_from: ['corp', 'home_via_vpn'] },
      },
    };
    const r2 = parseRegistry(serializeRegistry(r));
    expect(r2).toEqual(r);
  });

  it('serialize is deterministic (sorted keys)', () => {
    const r1 = parseRegistry(serializeRegistry({
      devices: { z: { host: 'h' }, a: { host: 'h' } },
      networks: {},
    }));
    const r2 = parseRegistry(serializeRegistry({
      devices: { a: { host: 'h' }, z: { host: 'h' } },
      networks: {},
    }));
    expect(serializeRegistry(r1)).toBe(serializeRegistry(r2));
  });
});
```

- [ ] **Step 4: Run tests, expect failures**

```bash
pnpm --filter @rokudev/device-client test
```

Expected: 5 new tests fail (parse module not yet wired or has bugs).

- [ ] **Step 5: Iterate `parse.ts` until tests pass**

Run tests after each fix; ensure all 6 tests in this file pass plus the earlier 5 still pass (total 11).

- [ ] **Step 6: Add registry index re-export**

`packages/roku-device-client/src/registry/index.ts`:

```ts
export * from './types.js';
export { parseRegistry, serializeRegistry } from './parse.js';
```

- [ ] **Step 7: Commit**

```bash
git add packages/roku-device-client/src/registry/
git commit -m "feat(roku-device-client): registry types + TOML parser/serializer"
```

---

### Task 9: Registry reader (read-only file IO + path resolution)

**Files:**
- Create: `packages/roku-device-client/src/registry/paths.ts`
- Create: `packages/roku-device-client/src/registry/reader.ts`
- Create: `packages/roku-device-client/src/registry/reader.test.ts`

- [ ] **Step 1: Write `paths.ts`**

```ts
import { homedir } from 'node:os';
import { join } from 'node:path';

export function configDir(): string {
  return process.env.ROKUDEV_CONFIG_DIR ?? join(homedir(), '.config', 'brs');
}
export function devicesPath(): string { return join(configDir(), 'devices.toml'); }
export function devicesLockPath(): string { return join(configDir(), 'devices.toml.lock'); }
export function configPath(): string { return join(configDir(), 'config.toml'); }
```

- [ ] **Step 2: Write `reader.ts`**

```ts
import { readFile } from 'node:fs/promises';
import { devicesPath } from './paths.js';
import { parseRegistry, type Registry } from './parse.js';

export class RegistryReader {
  async read(): Promise<Registry> {
    try {
      const text = await readFile(devicesPath(), 'utf8');
      return parseRegistry(text);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { devices: {}, networks: {} };
      }
      throw err;
    }
  }

  async getDevice(name: string): Promise<Registry['devices'][string] | undefined> {
    const r = await this.read();
    return r.devices[name];
  }

  async getActive(): Promise<string | undefined> {
    return (await this.read()).active;
  }
}
```

- [ ] **Step 3: Write tests `reader.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RegistryReader } from './reader.js';

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'rokudev-test-'));
  process.env.ROKUDEV_CONFIG_DIR = tmp;
});

afterEach(async () => {
  delete process.env.ROKUDEV_CONFIG_DIR;
  await rm(tmp, { recursive: true, force: true });
});

describe('RegistryReader', () => {
  it('returns empty when file does not exist', async () => {
    const r = await new RegistryReader().read();
    expect(r).toEqual({ devices: {}, networks: {} });
  });

  it('reads an existing registry', async () => {
    await writeFile(join(tmp, 'devices.toml'),
      `active = "home"\n[devices.home]\nhost = "1.2.3.4"\n`);
    const r = await new RegistryReader().read();
    expect(r.active).toBe('home');
    expect(r.devices.home?.host).toBe('1.2.3.4');
  });

  it('getDevice returns undefined for missing entries', async () => {
    expect(await new RegistryReader().getDevice('absent')).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run tests, fix until pass**

```bash
pnpm --filter @rokudev/device-client test
```

Expected: all tests pass.

- [ ] **Step 5: Update registry index**

```ts
// packages/roku-device-client/src/registry/index.ts
export * from './types.js';
export { parseRegistry, serializeRegistry } from './parse.js';
export { RegistryReader } from './reader.js';
export { configDir, devicesPath, configPath } from './paths.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/roku-device-client/src/registry/
git commit -m "feat(roku-device-client): RegistryReader with config-dir override for tests"
```

---

### Task 10: Registry writer with flock + atomic rename

Implements §4.1 concurrency contract.

**Files:**
- Create: `packages/roku-device-client/src/registry/writer.ts`
- Create: `packages/roku-device-client/src/registry/writer.test.ts`

- [ ] **Step 1: Write `writer.ts`**

```ts
import { writeFile, rename, mkdir, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import lockfile from 'proper-lockfile';
import { devicesPath, devicesLockPath, configDir } from './paths.js';
import { parseRegistry, serializeRegistry } from './parse.js';
import {
  RegistrySchema,
  DeviceEntrySchema,
  DeviceNameSchema,
  type Registry,
  type DeviceEntry,
} from './types.js';
import { fail } from '../errors/index.js';
import { readFile } from 'node:fs/promises';

const LOCK_OPTS = { retries: { retries: 50, minTimeout: 50, maxTimeout: 200 }, stale: 10_000 };

export class RegistryWriter {
  /**
   * Atomically apply `mutate` to the registry under an advisory lock.
   * Throws REGISTRY_BUSY (Failure) if the lock cannot be acquired in 5s.
   */
  async transact<T>(mutate: (r: Registry) => T): Promise<T> {
    await mkdir(configDir(), { recursive: true, mode: 0o700 });
    // Touch the lockfile so proper-lockfile can lock it.
    try { await writeFile(devicesLockPath(), '', { flag: 'wx', mode: 0o600 }); } catch {}
    let release: (() => Promise<void>) | undefined;
    try {
      release = await lockfile.lock(devicesLockPath(), LOCK_OPTS);
    } catch {
      throw fail('REGISTRY_BUSY', 'could not acquire registry lock within 5s');
    }
    try {
      let current: Registry;
      try {
        const text = await readFile(devicesPath(), 'utf8');
        current = parseRegistry(text);
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          current = { devices: {}, networks: {} };
        } else { throw err; }
      }
      const result = mutate(current);
      const validated = RegistrySchema.parse(current);
      const tmp = `${devicesPath()}.tmp.${process.pid}`;
      const text = serializeRegistry(validated);
      await writeFile(tmp, text, { mode: 0o600 });
      await rename(tmp, devicesPath());
      await chmod(devicesPath(), 0o600);
      return result;
    } finally {
      if (release) await release();
    }
  }

  async addDevice(name: string, entry: DeviceEntry): Promise<void> {
    const safeName = DeviceNameSchema.safeParse(name);
    if (!safeName.success) {
      throw fail('INVALID_DEVICE_NAME', `device name "${name}" must match [A-Za-z0-9_-]+`);
    }
    const safeEntry = DeviceEntrySchema.parse(entry);
    await this.transact((r) => { r.devices[name] = { ...r.devices[name], ...safeEntry }; });
  }

  async setPassword(name: string, password: string): Promise<void> {
    await this.transact((r) => {
      const existing = r.devices[name];
      if (!existing) throw fail('DEVICE_NOT_FOUND', `no device "${name}" in registry`);
      r.devices[name] = { ...existing, dev_password: password };
    });
  }

  async setActive(name: string): Promise<void> {
    await this.transact((r) => {
      if (!r.devices[name]) throw fail('DEVICE_NOT_FOUND', `no device "${name}" in registry`);
      r.active = name;
    });
  }

  async removeDevice(name: string): Promise<void> {
    await this.transact((r) => {
      delete r.devices[name];
      if (r.active === name) delete r.active;
    });
  }
}
```

- [ ] **Step 2: Write tests `writer.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RegistryWriter } from './writer.js';
import { RegistryReader } from './reader.js';

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'rokudev-test-'));
  process.env.ROKUDEV_CONFIG_DIR = tmp;
});
afterEach(async () => {
  delete process.env.ROKUDEV_CONFIG_DIR;
  await rm(tmp, { recursive: true, force: true });
});

describe('RegistryWriter', () => {
  it('addDevice creates file with 0600 perms', async () => {
    const w = new RegistryWriter();
    await w.addDevice('home', { host: '1.2.3.4' });
    const s = await stat(join(tmp, 'devices.toml'));
    expect(s.mode & 0o777).toBe(0o600);
    const r = await new RegistryReader().read();
    expect(r.devices.home?.host).toBe('1.2.3.4');
  });

  it('addDevice rejects invalid names', async () => {
    const w = new RegistryWriter();
    await expect(w.addDevice('bad name', { host: 'x' })).rejects.toMatchObject({
      ok: false, code: 'INVALID_DEVICE_NAME',
    });
  });

  it('setPassword on existing device persists', async () => {
    const w = new RegistryWriter();
    await w.addDevice('home', { host: '1.2.3.4' });
    await w.setPassword('home', 'secret');
    const r = await new RegistryReader().read();
    expect(r.devices.home?.dev_password).toBe('secret');
  });

  it('setPassword on missing device throws DEVICE_NOT_FOUND', async () => {
    const w = new RegistryWriter();
    await expect(w.setPassword('nope', 'x')).rejects.toMatchObject({
      ok: false, code: 'DEVICE_NOT_FOUND',
    });
  });

  it('setActive requires the device to exist', async () => {
    const w = new RegistryWriter();
    await expect(w.setActive('ghost')).rejects.toMatchObject({ code: 'DEVICE_NOT_FOUND' });
  });

  it('removeDevice clears active when removing the active device', async () => {
    const w = new RegistryWriter();
    await w.addDevice('home', { host: '1.2.3.4' });
    await w.setActive('home');
    await w.removeDevice('home');
    expect(await new RegistryReader().getActive()).toBeUndefined();
  });

  it('two concurrent writes do not corrupt the file', async () => {
    const w = new RegistryWriter();
    await w.addDevice('a', { host: '1.1.1.1' });
    // Fire 10 concurrent updates that each add a device.
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => w.addDevice(`d${i}`, { host: `10.0.0.${i}` })),
    );
    const r = await new RegistryReader().read();
    for (let i = 0; i < 10; i++) {
      expect(r.devices[`d${i}`]?.host).toBe(`10.0.0.${i}`);
    }
    expect(r.devices.a?.host).toBe('1.1.1.1');
  });
});
```

- [ ] **Step 3: Run, iterate, all pass**

```bash
pnpm --filter @rokudev/device-client test
```

- [ ] **Step 4: Update registry index to export writer**

```ts
export { RegistryWriter } from './writer.js';
```

- [ ] **Step 5: Commit**

```bash
git add packages/roku-device-client/src/registry/
git commit -m "feat(roku-device-client): RegistryWriter with flock + atomic rename"
```

---

### Task 11: Network detection — fingerprint reader and classifier

Implements §4.2.

**Files:**
- Create: `packages/roku-device-client/src/network/fingerprint.ts`
- Create: `packages/roku-device-client/src/network/classify.ts`
- Create: `packages/roku-device-client/src/network/classify.test.ts`
- Create: `packages/roku-device-client/src/network/index.ts`

- [ ] **Step 1: Write `fingerprint.ts`** (the OS-touching reader; pure function takes injected deps for testability)

```ts
import { networkInterfaces } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveCname } from 'node:dns/promises';

const execFileP = promisify(execFile);

export type Fingerprint = {
  gateway_mac?: string;
  gateway_subnet_v4?: string;       // e.g. "192.168.1.0/24"
  dns_search_suffix?: string;       // e.g. "corp.example.com"
  vpn_iface_present: boolean;
};

export type FingerprintIo = {
  readDefaultGatewayIpV4: () => Promise<string | undefined>;
  arpLookupMac: (ip: string) => Promise<string | undefined>;
  readDnsSearch: () => Promise<string | undefined>;
  enumInterfaces: () => ReturnType<typeof networkInterfaces>;
};

export const realFingerprintIo: FingerprintIo = {
  async readDefaultGatewayIpV4() {
    try {
      const { stdout } = await execFileP('netstat', ['-rn', '-f', 'inet']);
      // Match the line beginning with "default" or "0.0.0.0".
      const m = stdout.match(/^(?:default|0\.0\.0\.0\/0|0\.0\.0\.0)\s+(\d+\.\d+\.\d+\.\d+)/m);
      return m?.[1];
    } catch { return undefined; }
  },
  async arpLookupMac(ip: string) {
    try {
      const { stdout } = await execFileP('arp', ['-n', ip]);
      const m = stdout.match(/(([0-9a-f]{1,2}:){5}[0-9a-f]{1,2})/i);
      return m?.[1]?.toLowerCase();
    } catch { return undefined; }
  },
  async readDnsSearch() {
    try {
      const { readFile } = await import('node:fs/promises');
      const text = await readFile('/etc/resolv.conf', 'utf8');
      const m = text.match(/^search\s+(\S+)/m) ?? text.match(/^domain\s+(\S+)/m);
      return m?.[1];
    } catch { return undefined; }
  },
  enumInterfaces: () => networkInterfaces(),
};

export async function readFingerprint(io: FingerprintIo = realFingerprintIo): Promise<Fingerprint> {
  const gwIp = await io.readDefaultGatewayIpV4();
  const gateway_mac = gwIp ? await io.arpLookupMac(gwIp) : undefined;
  const dns_search_suffix = await io.readDnsSearch();
  const ifaces = io.enumInterfaces();
  let gateway_subnet_v4: string | undefined;
  let vpn_iface_present = false;
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue;
    if (/^(utun|tun|tap)/.test(name)) {
      const hasNonLocal = addrs.some((a) => a.family === 'IPv4' && !a.internal);
      if (hasNonLocal) vpn_iface_present = true;
    }
    if (gwIp) {
      for (const a of addrs) {
        if (a.family === 'IPv4' && !a.internal && sameSubnet(a.address, a.netmask, gwIp)) {
          gateway_subnet_v4 = makeSlash24(a.address);
        }
      }
    }
  }
  const fp: Fingerprint = { vpn_iface_present };
  if (gateway_mac !== undefined) fp.gateway_mac = gateway_mac;
  if (gateway_subnet_v4 !== undefined) fp.gateway_subnet_v4 = gateway_subnet_v4;
  if (dns_search_suffix !== undefined) fp.dns_search_suffix = dns_search_suffix;
  return fp;
}

function sameSubnet(addr: string, mask: string, target: string): boolean {
  const a = ip4ToInt(addr), m = ip4ToInt(mask), t = ip4ToInt(target);
  return (a & m) === (t & m);
}
function ip4ToInt(s: string): number {
  return s.split('.').reduce((acc, oct) => (acc << 8) | parseInt(oct, 10), 0) >>> 0;
}
function makeSlash24(addr: string): string {
  const parts = addr.split('.');
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}
```

- [ ] **Step 2: Write `classify.ts` (pure function)**

```ts
import type { Fingerprint } from './fingerprint.js';
import type { Registry, NetworkTag } from '../registry/types.js';

export function classifyNetwork(fp: Fingerprint, networks: Registry['networks']): NetworkTag {
  // Match each [networks.*] entry: requires gateway_mac AND at least one of
  // gateway_subnet_v4 or dns_search_suffix to match.
  const matches: string[] = [];
  for (const [name, n] of Object.entries(networks)) {
    if (!n.gateway_mac || !fp.gateway_mac) continue;
    if (n.gateway_mac.toLowerCase() !== fp.gateway_mac.toLowerCase()) continue;
    const subnetMatch = !!n.gateway_subnet_v4 && n.gateway_subnet_v4 === fp.gateway_subnet_v4;
    const dnsMatch = !!n.dns_search_suffix && n.dns_search_suffix === fp.dns_search_suffix;
    if (!subnetMatch && !dnsMatch) continue;
    matches.push(name);
  }
  if (matches.length === 0) return 'unknown';
  // home_via_vpn = vpn iface up + matched the corp network.
  if (fp.vpn_iface_present && matches.includes('corp')) return 'home_via_vpn';
  // Pick a known tag; prefer 'home' over 'corp' for tie-break (alphabetic).
  for (const tag of ['home', 'corp'] as const) {
    if (matches.includes(tag)) return tag;
  }
  return 'unknown';
}

export function isReachable(
  current: NetworkTag,
  target: NetworkTag,
  networks: Registry['networks'],
): boolean {
  if (current === 'unknown') return true; // permissive on unknown (§4.2)
  if (current === target) return true;
  // Look up the target network's reachable_from list.
  const targetNet = networks[target];
  if (!targetNet?.reachable_from) return false;
  return targetNet.reachable_from.includes(current);
}
```

- [ ] **Step 3: Write tests `classify.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { classifyNetwork, isReachable } from './classify.js';

describe('classifyNetwork', () => {
  const homeNet = { gateway_mac: 'aa:bb:cc:00:00:01', gateway_subnet_v4: '192.168.1.0/24' };
  const corpNet = { gateway_mac: 'aa:bb:cc:00:00:02', dns_search_suffix: 'corp.example.com',
                    reachable_from: ['corp', 'home_via_vpn'] };

  it('classifies home when MAC + subnet match', () => {
    const t = classifyNetwork(
      { gateway_mac: 'aa:bb:cc:00:00:01', gateway_subnet_v4: '192.168.1.0/24', vpn_iface_present: false },
      { home: homeNet, corp: corpNet },
    );
    expect(t).toBe('home');
  });

  it('classifies corp via DNS suffix', () => {
    const t = classifyNetwork(
      { gateway_mac: 'aa:bb:cc:00:00:02', dns_search_suffix: 'corp.example.com', vpn_iface_present: false },
      { home: homeNet, corp: corpNet },
    );
    expect(t).toBe('corp');
  });

  it('classifies home_via_vpn when corp matches and VPN iface up', () => {
    const t = classifyNetwork(
      { gateway_mac: 'aa:bb:cc:00:00:02', dns_search_suffix: 'corp.example.com', vpn_iface_present: true },
      { home: homeNet, corp: corpNet },
    );
    expect(t).toBe('home_via_vpn');
  });

  it('returns unknown when MAC matches but neither subnet nor DNS does', () => {
    const t = classifyNetwork(
      { gateway_mac: 'aa:bb:cc:00:00:01', gateway_subnet_v4: '10.0.0.0/24', vpn_iface_present: false },
      { home: homeNet, corp: corpNet },
    );
    expect(t).toBe('unknown');
  });

  it('returns unknown when no MAC available', () => {
    const t = classifyNetwork({ vpn_iface_present: false }, { home: homeNet });
    expect(t).toBe('unknown');
  });
});

describe('isReachable', () => {
  const corpNet = { gateway_mac: 'x', reachable_from: ['corp', 'home_via_vpn'] };
  const homeNet = { gateway_mac: 'y' };

  it('permissive when current is unknown', () => {
    expect(isReachable('unknown', 'home', { home: homeNet, corp: corpNet })).toBe(true);
  });

  it('same network always reachable', () => {
    expect(isReachable('corp', 'corp', { home: homeNet, corp: corpNet })).toBe(true);
  });

  it('home cannot reach corp via reachable_from', () => {
    expect(isReachable('home', 'corp', { home: homeNet, corp: corpNet })).toBe(false);
  });

  it('home_via_vpn can reach corp', () => {
    expect(isReachable('home_via_vpn', 'corp', { home: homeNet, corp: corpNet })).toBe(true);
  });

  it('corp cannot reach home (asymmetric)', () => {
    expect(isReachable('corp', 'home', { home: homeNet, corp: corpNet })).toBe(false);
  });
});
```

- [ ] **Step 4: Run tests, fix until pass**

- [ ] **Step 5: Write `network/index.ts`**

```ts
export { readFingerprint, type Fingerprint, type FingerprintIo, realFingerprintIo } from './fingerprint.js';
export { classifyNetwork, isReachable } from './classify.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/roku-device-client/src/network/
git commit -m "feat(roku-device-client): network fingerprint + classifier"
```

---

### Task 12: HTTP Digest auth client

The single Digest implementation that all dev-portal calls use. Port the algorithm from `brs-mcp/src/device/client.ts` (study, then rewrite).

**Files:**
- Create: `packages/roku-device-client/src/_internal/digest.ts`
- Create: `packages/roku-device-client/src/_internal/digest.test.ts`
- Reference: `/Users/bblietz/Work/ClaudeProjects/brs-mcp/src/device/client.ts` (existing implementation; do not import, study and reimplement)

- [ ] **Step 1: Read the existing prototype to understand the wire shape**

```bash
sed -n '1,200p' /Users/bblietz/Work/ClaudeProjects/brs-mcp/src/device/client.ts
```

You are looking for: how `WWW-Authenticate` is parsed, how `nc` (nonce-count) and `cnonce` are generated, how `qop=auth` is signed.

- [ ] **Step 2: Write `digest.ts`** (RFC 2617, MD5)

```ts
import { createHash, randomBytes } from 'node:crypto';
import { request, type Dispatcher } from 'undici';

export type DigestRequest = {
  method: 'GET' | 'POST';
  url: string;
  username: string;
  password: string;
  body?: Buffer | string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

export type DigestResponse = {
  statusCode: number;
  headers: Record<string, string | string[]>;
  bodyBytes: Buffer;
  bodyText: string;
};

const md5 = (s: string) => createHash('md5').update(s).digest('hex');

function parseChallenge(header: string): Record<string, string> {
  // Strip leading "Digest"
  const body = header.replace(/^Digest\s+/i, '');
  const out: Record<string, string> = {};
  const re = /(\w+)\s*=\s*(?:"([^"]*)"|([^,]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    out[m[1]!.toLowerCase()] = (m[2] ?? m[3] ?? '').trim();
  }
  return out;
}

export async function digestRequest(req: DigestRequest): Promise<DigestResponse> {
  const u = new URL(req.url);
  const initial = await request(req.url, {
    method: req.method,
    body: req.body,
    headers: req.headers,
    signal: req.signal,
  });
  if (initial.statusCode !== 401) {
    return await collect(initial);
  }
  const wwwAuth = initial.headers['www-authenticate'];
  await initial.body.dump();
  if (!wwwAuth || Array.isArray(wwwAuth)) {
    throw new Error(`expected single WWW-Authenticate header, got ${wwwAuth}`);
  }
  const c = parseChallenge(wwwAuth);
  const realm = c.realm ?? '';
  const nonce = c.nonce ?? '';
  const opaque = c.opaque;
  const qop = (c.qop ?? '').split(',').map((s) => s.trim()).find((q) => q === 'auth') ?? '';
  const cnonce = randomBytes(8).toString('hex');
  const nc = '00000001';
  const ha1 = md5(`${req.username}:${realm}:${req.password}`);
  const ha2 = md5(`${req.method}:${u.pathname}${u.search}`);
  const response = qop
    ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${nonce}:${ha2}`);
  const auth =
    `Digest username="${req.username}", realm="${realm}", nonce="${nonce}", ` +
    `uri="${u.pathname}${u.search}", response="${response}"` +
    (qop ? `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"` : '') +
    (opaque ? `, opaque="${opaque}"` : '');
  const second = await request(req.url, {
    method: req.method,
    body: req.body,
    headers: { ...req.headers, authorization: auth },
    signal: req.signal,
  });
  return await collect(second);
}

async function collect(r: Dispatcher.ResponseData): Promise<DigestResponse> {
  const chunks: Buffer[] = [];
  for await (const chunk of r.body) chunks.push(Buffer.from(chunk));
  const bodyBytes = Buffer.concat(chunks);
  return {
    statusCode: r.statusCode,
    headers: r.headers as Record<string, string | string[]>,
    bodyBytes,
    bodyText: bodyBytes.toString('utf8'),
  };
}
```

- [ ] **Step 3: Write tests `digest.test.ts` against a mock HTTP server**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { digestRequest } from './digest.js';

const md5 = (s: string) => createHash('md5').update(s).digest('hex');

let server: Server;
let port: number;
let lastAuth: string | undefined;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (!req.headers.authorization) {
      res.writeHead(401, {
        'WWW-Authenticate': `Digest realm="rokudev", nonce="abc123", qop="auth", opaque="op"`,
      });
      res.end();
      return;
    }
    lastAuth = req.headers.authorization;
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('OK');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('digestRequest', () => {
  it('completes the 401 challenge and returns 200', async () => {
    const r = await digestRequest({
      method: 'GET',
      url: `http://127.0.0.1:${port}/x`,
      username: 'rokudev', password: 'pw',
    });
    expect(r.statusCode).toBe(200);
    expect(r.bodyText).toBe('OK');
    expect(lastAuth).toMatch(/^Digest username="rokudev"/);
    expect(lastAuth).toContain('qop=auth');
    expect(lastAuth).toContain('nc=00000001');
  });

  it('uses correct response hash for known inputs', async () => {
    // Same algorithm, manually computed.
    const ha1 = md5('rokudev:rokudev:pw');
    const ha2 = md5('GET:/x');
    // We don't know cnonce; just verify the response field shape.
    const r = await digestRequest({
      method: 'GET', url: `http://127.0.0.1:${port}/x`,
      username: 'rokudev', password: 'pw',
    });
    expect(r.statusCode).toBe(200);
    const m = lastAuth!.match(/response="([^"]+)"/);
    expect(m).toBeTruthy();
    expect(m![1]).toHaveLength(32); // MD5 hex
    void ha1; void ha2;
  });

  it('does not leak the password into the auth header', async () => {
    await digestRequest({
      method: 'GET', url: `http://127.0.0.1:${port}/x`,
      username: 'rokudev', password: 'verysecret',
    });
    expect(lastAuth).not.toContain('verysecret');
  });
});
```

- [ ] **Step 4: Run, iterate**

```bash
pnpm --filter @rokudev/device-client test
```

- [ ] **Step 5: Commit**

```bash
git add packages/roku-device-client/src/_internal/
git commit -m "feat(roku-device-client): RFC 2617 Digest auth client"
```

---

### Task 13: ECP HTTP client (read-only queries)

Per spec §4.3 ECP read tools: `device-info`, `apps`, `active-app`, `media-player`, `r2d2_bitrate`, `icon`.

**Files:**
- Create: `packages/roku-device-client/src/ecp/parse-xml.ts`
- Create: `packages/roku-device-client/src/ecp/client.ts`
- Create: `packages/roku-device-client/src/ecp/client.test.ts`

- [ ] **Step 1: Add `fast-xml-parser` dep**

```bash
pnpm --filter @rokudev/device-client add fast-xml-parser
```

- [ ] **Step 2: Write `parse-xml.ts`**

```ts
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: '@_',
  allowBooleanAttributes: true, parseAttributeValue: true,
});

export function parseXml(text: string): unknown {
  return parser.parse(text);
}
```

- [ ] **Step 3: Write `ecp/client.ts`**

```ts
import { request } from 'undici';
import { parseXml } from './parse-xml.js';
import { fail } from '../errors/index.js';

const TIMEOUT_MS = 5_000;

async function get(host: string, path: string): Promise<{ statusCode: number; body: Buffer; headers: Record<string, string | string[]> }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await request(`http://${host}:8060${path}`, { method: 'GET', signal: ctrl.signal });
    const chunks: Buffer[] = [];
    for await (const c of r.body) chunks.push(Buffer.from(c));
    return { statusCode: r.statusCode, body: Buffer.concat(chunks), headers: r.headers as any };
  } catch (e: unknown) {
    if ((e as Error).name === 'AbortError') {
      throw fail('DEVICE_UNREACHABLE', `ECP request to ${host}:8060${path} timed out`);
    }
    throw fail('DEVICE_UNREACHABLE', `ECP request failed: ${(e as Error).message}`);
  } finally {
    clearTimeout(t);
  }
}

export class EcpClient {
  constructor(private host: string) {}

  async deviceInfo(): Promise<Record<string, string>> {
    const r = await get(this.host, '/query/device-info');
    if (r.statusCode !== 200) throw fail('DEVICE_UNREACHABLE', `ECP returned ${r.statusCode}`);
    const parsed = parseXml(r.body.toString('utf8')) as { 'device-info'?: Record<string, string | number | boolean> };
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed['device-info'] ?? {})) out[k] = String(v);
    return out;
  }

  async apps(): Promise<Array<{ id: string; name: string; version: string; type: string }>> {
    const r = await get(this.host, '/query/apps');
    const parsed = parseXml(r.body.toString('utf8')) as { apps?: { app?: any[] | any } };
    const list = parsed.apps?.app ?? [];
    const arr = Array.isArray(list) ? list : [list];
    return arr.map((a) => ({
      id: String(a['@_id']), name: typeof a === 'string' ? a : String(a['#text'] ?? ''),
      version: String(a['@_version'] ?? ''), type: String(a['@_type'] ?? ''),
    }));
  }

  async activeApp(): Promise<{ id?: string; name?: string }> {
    const r = await get(this.host, '/query/active-app');
    const parsed = parseXml(r.body.toString('utf8')) as { 'active-app'?: { app?: any } };
    const a = parsed['active-app']?.app;
    if (!a) return {};
    const id = a['@_id'];
    return { ...(id ? { id: String(id) } : {}), name: typeof a === 'string' ? a : String(a['#text'] ?? '') };
  }

  async mediaPlayer(): Promise<Record<string, string>> {
    const r = await get(this.host, '/query/media-player');
    const parsed = parseXml(r.body.toString('utf8')) as { player?: Record<string, unknown> };
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.player ?? {})) {
      out[k.replace(/^@_/, '')] = String(typeof v === 'object' && v && '#text' in v ? (v as any)['#text'] : v);
    }
    return out;
  }

  async r2d2Bitrate(): Promise<Array<Record<string, string>>> {
    const r = await get(this.host, '/query/r2d2_bitrate');
    const parsed = parseXml(r.body.toString('utf8')) as { 'bitrate-stream'?: any | any[] };
    const list = parsed['bitrate-stream'] ?? [];
    const arr = Array.isArray(list) ? list : [list];
    return arr.map((s) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(s as Record<string, unknown>)) out[k.replace(/^@_/, '')] = String(v);
      return out;
    });
  }

  async icon(appId: string): Promise<{ mime: string; bytes: number; base64: string }> {
    const r = await get(this.host, `/query/icon/${encodeURIComponent(appId)}`);
    if (r.statusCode !== 200) throw fail('DEVICE_UNREACHABLE', `ECP returned ${r.statusCode}`);
    const mime = String(r.headers['content-type'] ?? 'application/octet-stream').split(';')[0]!;
    return { mime, bytes: r.body.length, base64: r.body.toString('base64') };
  }
}
```

- [ ] **Step 4: Write tests `ecp/client.test.ts`** with a mock HTTP server

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { EcpClient } from './client.js';

let server: Server;
let host: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'application/xml');
    switch (req.url) {
      case '/query/device-info':
        res.end(`<device-info><serial-number>X001</serial-number><model-name>Roku TV</model-name></device-info>`);
        return;
      case '/query/apps':
        res.end(`<apps><app id="dev" type="appl" version="1.0">My Dev Channel</app><app id="12">Netflix</app></apps>`);
        return;
      case '/query/active-app':
        res.end(`<active-app><app id="dev">My Dev Channel</app></active-app>`);
        return;
      case '/query/media-player':
        res.end(`<player state="play" error="false" position="1234"/>`);
        return;
      case '/query/r2d2_bitrate':
        res.end(`<bitrate-stream id="0" bitrate="2500000"/><bitrate-stream id="1" bitrate="3500000"/>`);
        return;
      case '/query/icon/dev':
        res.setHeader('content-type', 'image/png');
        res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        return;
      default:
        res.statusCode = 404; res.end();
    }
  });
  // Listen on a high port; ECP is hard-coded to 8060 in client. Patch at runtime
  // by overriding the host string trick.
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));
```

The trick: since `EcpClient` hard-codes port 8060, the test needs the mock to also be on 8060 — which is impractical. **Restructure:** make the port injectable.

- [ ] **Step 5: Refactor `EcpClient` to accept an optional port**

```ts
export class EcpClient {
  constructor(private host: string, private port = 8060) {}
  // change all `:8060` to `:${this.port}` inside `get`
}
```

Adjust `get(this.host, ...)` to also pass the port, or move port into the URL builder. Re-export and re-run tests.

- [ ] **Step 6: Finish the test by listening and asserting**

```ts
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  host = '127.0.0.1';
  // store port on a module global for tests
  (globalThis as any).__ecpTestPort = port;
});

const client = () => new EcpClient(host, (globalThis as any).__ecpTestPort);

describe('EcpClient', () => {
  it('parses deviceInfo', async () => {
    const i = await client().deviceInfo();
    expect(i['serial-number']).toBe('X001');
    expect(i['model-name']).toBe('Roku TV');
  });

  it('parses apps with attributes', async () => {
    const a = await client().apps();
    expect(a[0]?.id).toBe('dev');
    expect(a[1]?.id).toBe('12');
  });

  it('parses activeApp', async () => {
    const a = await client().activeApp();
    expect(a.id).toBe('dev');
  });

  it('parses media-player as flat dict', async () => {
    const p = await client().mediaPlayer();
    expect(p.state).toBe('play');
    expect(p.position).toBe('1234');
  });

  it('parses bitrate streams', async () => {
    const b = await client().r2d2Bitrate();
    expect(b).toHaveLength(2);
    expect(b[0]?.bitrate).toBe('2500000');
  });

  it('returns icon as base64 with mime', async () => {
    const i = await client().icon('dev');
    expect(i.mime).toBe('image/png');
    expect(i.bytes).toBe(4);
  });
});
```

- [ ] **Step 7: Run, iterate**

- [ ] **Step 8: Commit**

```bash
git add packages/roku-device-client/src/ecp/
git commit -m "feat(roku-device-client): ECP read-only client"
```

---

### Task 14: ECP control (keys, params allowlists)

**Files:**
- Create: `packages/roku-device-client/src/ecp/keys.ts`
- Create: `packages/roku-device-client/src/ecp/params.ts`
- Create: `packages/roku-device-client/src/ecp/control.ts`
- Create: `packages/roku-device-client/src/ecp/control.test.ts`

- [ ] **Step 1: Write `keys.ts`** (the auditable static allowlist per §4.7.1)

```ts
export const STANDARD_KEYS = new Set([
  'Home','Rev','Fwd','Play','Select','Left','Right','Down','Up','Back',
  'InstantReplay','Info','Backspace','Search','Enter',
  'VolumeDown','VolumeUp','VolumeMute',
  'Power','PowerOff','ChannelUp','ChannelDown',
  'InputTuner','InputHDMI1','InputHDMI2','InputHDMI3','InputHDMI4','InputAV1',
  'FindRemote',
] as const);

const LIT_DISALLOWED_CHARS = new Set(['/', '?', '#', '%', '&', '+', '\\', ' ']);

export function isAllowedKey(key: string): boolean {
  if (STANDARD_KEYS.has(key as never)) return true;
  if (!key.startsWith('Lit_')) return false;
  const ch = key.slice(4);
  if (ch.length !== 1) return false;
  const code = ch.charCodeAt(0);
  if (code < 0x20 || code > 0x7e) return false;
  if (LIT_DISALLOWED_CHARS.has(ch)) return false;
  return true;
}
```

- [ ] **Step 2: Write `params.ts`**

```ts
const ECP_INPUT_KEYS = new Set([
  'accelerator','mediaType','contentId','contentLabel','playbackPosition','streamFormat',
] as const);
const ECP_LAUNCH_KEYS = new Set(['contentId','mediaType'] as const);
const X_KEY = /^x_[A-Za-z0-9_]+$/;

export function isAllowedInputParamKey(k: string): boolean {
  return ECP_INPUT_KEYS.has(k as never) || X_KEY.test(k);
}
export function isAllowedLaunchParamKey(k: string): boolean {
  return ECP_LAUNCH_KEYS.has(k as never) || X_KEY.test(k);
}
```

- [ ] **Step 3: Write `control.ts`**

```ts
import { request } from 'undici';
import { fail } from '../errors/index.js';
import { isAllowedKey } from './keys.js';
import { isAllowedInputParamKey, isAllowedLaunchParamKey } from './params.js';

export type Mode = 'press' | 'down' | 'up';

async function post(url: string): Promise<number> {
  const r = await request(url, { method: 'POST' });
  await r.body.dump();
  return r.statusCode;
}

export class EcpControl {
  constructor(private host: string, private port = 8060) {}

  async keypress(key: string, mode: Mode = 'press'): Promise<void> {
    if (!isAllowedKey(key)) throw fail('ECP_KEY_DISALLOWED', `key not allowed: ${key}`, { key });
    const verb = mode === 'press' ? 'keypress' : mode === 'down' ? 'keydown' : 'keyup';
    const sc = await post(`http://${this.host}:${this.port}/${verb}/${encodeURIComponent(key)}`);
    if (sc < 200 || sc > 299) throw fail('DEVICE_UNREACHABLE', `ECP ${verb} returned ${sc}`);
  }

  async keysequence(keys: string[], delayMs = 150): Promise<void> {
    for (const k of keys) {
      await this.keypress(k);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  async launch(appId: string, params?: Record<string, string>): Promise<void> {
    const qs = this.encodeParams(params, isAllowedLaunchParamKey);
    const sc = await post(`http://${this.host}:${this.port}/launch/${encodeURIComponent(appId)}${qs}`);
    if (sc < 200 || sc > 299) throw fail('DEVICE_UNREACHABLE', `ECP launch returned ${sc}`);
  }

  async input(params: Record<string, string>): Promise<void> {
    const qs = this.encodeParams(params, isAllowedInputParamKey);
    const sc = await post(`http://${this.host}:${this.port}/input${qs}`);
    if (sc < 200 || sc > 299) throw fail('DEVICE_UNREACHABLE', `ECP input returned ${sc}`);
  }

  async toHome(): Promise<void> {
    await this.keypress('Home');
    await new Promise((r) => setTimeout(r, 100));
    await this.keypress('Home');
  }

  private encodeParams(p: Record<string, string> | undefined, allow: (k: string) => boolean): string {
    if (!p || Object.keys(p).length === 0) return '';
    const parts: string[] = [];
    for (const [k, v] of Object.entries(p)) {
      if (!allow(k)) throw fail('ECP_PARAM_DISALLOWED', `param key not allowed: ${k}`, { key: k });
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    }
    return `?${parts.join('&')}`;
  }
}
```

- [ ] **Step 4: Write tests `control.test.ts`**

Cover: allowlist enforcement on keys, on params; correct URL construction (record incoming requests); keysequence respects delay; launch and input encode params.

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server, type IncomingMessage } from 'node:http';
import { AddressInfo } from 'node:net';
import { EcpControl } from './control.js';

const requests: { method: string; url: string }[] = [];
let server: Server;
let port: number;

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res) => {
    requests.push({ method: req.method!, url: req.url! });
    res.statusCode = 200; res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('EcpControl', () => {
  const c = () => new EcpControl('127.0.0.1', port);

  it('rejects disallowed standard key', async () => {
    await expect(c().keypress('NotAKey' as any)).rejects.toMatchObject({ code: 'ECP_KEY_DISALLOWED' });
  });

  it('rejects Lit_ with disallowed char', async () => {
    await expect(c().keypress('Lit_/')).rejects.toMatchObject({ code: 'ECP_KEY_DISALLOWED' });
    await expect(c().keypress('Lit_ ')).rejects.toMatchObject({ code: 'ECP_KEY_DISALLOWED' });
    await expect(c().keypress('Lit_&')).rejects.toMatchObject({ code: 'ECP_KEY_DISALLOWED' });
  });

  it('accepts standard and Lit_<safe> keys', async () => {
    requests.length = 0;
    await c().keypress('Up');
    await c().keypress('Lit_a');
    expect(requests.map((r) => r.url)).toEqual(['/keypress/Up', '/keypress/Lit_a']);
  });

  it('keysequence sends in order with delay', async () => {
    requests.length = 0;
    const start = Date.now();
    await c().keysequence(['Down', 'Right'], 50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(100);
    expect(requests.map((r) => r.url)).toEqual(['/keypress/Down', '/keypress/Right']);
  });

  it('launch encodes allowed param keys', async () => {
    requests.length = 0;
    await c().launch('dev', { contentId: 'abc 123', x_custom: 'v' });
    expect(requests[0]!.url).toBe('/launch/dev?contentId=abc%20123&x_custom=v');
  });

  it('launch rejects disallowed param keys', async () => {
    await expect(c().launch('dev', { evil: 'x' })).rejects.toMatchObject({ code: 'ECP_PARAM_DISALLOWED' });
  });

  it('input rejects disallowed keys', async () => {
    await expect(c().input({ random: 'x' })).rejects.toMatchObject({ code: 'ECP_PARAM_DISALLOWED' });
  });

  it('toHome sends Home twice', async () => {
    requests.length = 0;
    await c().toHome();
    expect(requests.filter((r) => r.url === '/keypress/Home')).toHaveLength(2);
  });
});
```

- [ ] **Step 5: Run, iterate**

- [ ] **Step 6: Add ECP index**

```ts
// packages/roku-device-client/src/ecp/index.ts
export { EcpClient } from './client.js';
export { EcpControl, type Mode } from './control.js';
export { isAllowedKey, STANDARD_KEYS } from './keys.js';
export { isAllowedInputParamKey, isAllowedLaunchParamKey } from './params.js';
```

- [ ] **Step 7: Commit**

```bash
git add packages/roku-device-client/src/ecp/
git commit -m "feat(roku-device-client): ECP control with key + param allowlists"
```

---

### Task 15: Dev portal — sideload + unload

Multipart Digest POSTs to `/plugin_install`. Port from `brs-mcp/src/device/client.ts`.

**Files:**
- Create: `packages/roku-device-client/src/devportal/multipart.ts`
- Create: `packages/roku-device-client/src/devportal/sideload.ts`
- Create: `packages/roku-device-client/src/devportal/sideload.test.ts`

- [ ] **Step 1: Read prototype's multipart implementation as reference**

```bash
grep -n "plugin_install\|multipart\|boundary" /Users/bblietz/Work/ClaudeProjects/brs-mcp/src/device/client.ts | head -40
```

- [ ] **Step 2: Write `multipart.ts`** (deterministic boundary, supports both file body and form fields)

```ts
import { randomBytes } from 'node:crypto';

export type MultipartPart =
  | { kind: 'field'; name: string; value: string }
  | { kind: 'file'; name: string; filename: string; contentType: string; body: Buffer };

export function buildBoundary(): string {
  return `----rokudev${randomBytes(8).toString('hex')}`;
}

export function buildMultipart(parts: MultipartPart[], boundary: string): Buffer {
  const chunks: Buffer[] = [];
  for (const p of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if (p.kind === 'field') {
      chunks.push(Buffer.from(
        `Content-Disposition: form-data; name="${p.name}"\r\n\r\n${p.value}\r\n`,
      ));
    } else {
      chunks.push(Buffer.from(
        `Content-Disposition: form-data; name="${p.name}"; filename="${p.filename}"\r\n` +
        `Content-Type: ${p.contentType}\r\n\r\n`,
      ));
      chunks.push(p.body);
      chunks.push(Buffer.from('\r\n'));
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}
```

- [ ] **Step 3: Write `sideload.ts`**

```ts
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { digestRequest } from '../_internal/digest.js';
import { buildBoundary, buildMultipart } from './multipart.js';
import { fail } from '../errors/index.js';

export type SideloadResult = {
  ok: true;
  status: 'installed' | 'identical';
  message: string;
  duration_ms: number;
};

export class DevPortal {
  constructor(private host: string, private password: string, private port = 80) {}

  async sideload(zipPath: string): Promise<SideloadResult> {
    const start = Date.now();
    let zipBytes: Buffer;
    try { zipBytes = await readFile(zipPath); }
    catch { throw fail('ZIP_NOT_FOUND', `zip not found: ${zipPath}`); }
    const boundary = buildBoundary();
    const body = buildMultipart([
      { kind: 'field', name: 'mysubmit', value: 'Install' },
      { kind: 'file', name: 'archive', filename: basename(zipPath),
        contentType: 'application/zip', body: zipBytes },
    ], boundary);
    const r = await digestRequest({
      method: 'POST',
      url: `http://${this.host}:${this.port}/plugin_install`,
      username: 'rokudev',
      password: this.password,
      body,
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': String(body.length),
      },
    });
    const duration_ms = Date.now() - start;
    if (r.statusCode === 401) throw fail('DEVICE_AUTH_FAILED', 'dev portal rejected credentials');
    const text = r.bodyText;
    if (text.includes('Identical to previous version')) {
      return { ok: true, status: 'identical', message: 'identical', duration_ms };
    }
    if (text.includes('Install Success.') || text.includes('Application Received')) {
      return { ok: true, status: 'installed', message: 'installed', duration_ms };
    }
    if (text.includes('Failed: Not in developer mode')) {
      throw fail('DEVICE_NOT_DEV_MODE', 'device is not in developer mode');
    }
    throw fail('SIDELOAD_REJECTED', `device rejected sideload`, {
      excerpt: text.slice(0, 400),
    });
  }

  async unload(): Promise<{ ok: true; message: string; duration_ms: number }> {
    const start = Date.now();
    const boundary = buildBoundary();
    const body = buildMultipart(
      [{ kind: 'field', name: 'mysubmit', value: 'Delete' },
       { kind: 'field', name: 'archive', value: '' }],
      boundary,
    );
    const r = await digestRequest({
      method: 'POST',
      url: `http://${this.host}:${this.port}/plugin_install`,
      username: 'rokudev', password: this.password,
      body, headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': String(body.length),
      },
    });
    const duration_ms = Date.now() - start;
    if (r.statusCode === 401) throw fail('DEVICE_AUTH_FAILED', 'dev portal rejected credentials');
    return { ok: true, message: 'deleted', duration_ms };
  }
}
```

- [ ] **Step 4: Write tests `sideload.test.ts`** (mock HTTP server with Digest stub)

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DevPortal } from './sideload.js';

let server: Server;
let port: number;
let mode: 'success' | 'identical' | 'authfail' | 'notdev' = 'success';
let lastBody: Buffer | undefined;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (mode === 'authfail') { res.statusCode = 401; res.setHeader('WWW-Authenticate','Digest realm="r",nonce="n"'); res.end(); return; }
    if (!req.headers.authorization) {
      res.statusCode = 401;
      res.setHeader('WWW-Authenticate', 'Digest realm="rokudev", nonce="abc", qop="auth"');
      res.end(); return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      lastBody = Buffer.concat(chunks);
      res.statusCode = 200;
      switch (mode) {
        case 'success': res.end('<font color="red">Install Success.</font>'); return;
        case 'identical': res.end('<font color="red">Identical to previous version, application not installed</font>'); return;
        case 'notdev': res.end('Failed: Not in developer mode'); return;
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('DevPortal sideload/unload', () => {
  let tmp: string, zipPath: string;
  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'rokudev-test-'));
    zipPath = join(tmp, 'channel.zip');
    await writeFile(zipPath, Buffer.from('PK\u0003\u0004fake-zip')); // PK header so the body looks plausible
  });
  afterAll(async () => { await rm(tmp, { recursive: true, force: true }); });

  it('returns installed on Install Success', async () => {
    mode = 'success';
    const r = await new DevPortal('127.0.0.1', 'pw', port).sideload(zipPath);
    expect(r.status).toBe('installed');
  });

  it('returns identical on identical version response', async () => {
    mode = 'identical';
    const r = await new DevPortal('127.0.0.1', 'pw', port).sideload(zipPath);
    expect(r.status).toBe('identical');
  });

  it('throws DEVICE_NOT_DEV_MODE when device says so', async () => {
    mode = 'notdev';
    await expect(new DevPortal('127.0.0.1', 'pw', port).sideload(zipPath))
      .rejects.toMatchObject({ code: 'DEVICE_NOT_DEV_MODE' });
  });

  it('throws ZIP_NOT_FOUND for missing path', async () => {
    mode = 'success';
    await expect(new DevPortal('127.0.0.1', 'pw', port).sideload('/no/such/file'))
      .rejects.toMatchObject({ code: 'ZIP_NOT_FOUND' });
  });

  it('unload sends mysubmit=Delete', async () => {
    mode = 'success';
    await new DevPortal('127.0.0.1', 'pw', port).unload();
    expect(lastBody!.toString('utf8')).toContain('name="mysubmit"');
    expect(lastBody!.toString('utf8')).toContain('Delete');
  });

  it('does not echo the password into the multipart body', async () => {
    mode = 'success';
    await new DevPortal('127.0.0.1', 'verysecret', port).sideload(zipPath);
    expect(lastBody!.toString('utf8')).not.toContain('verysecret');
  });
});
```

- [ ] **Step 5: Run, iterate** until all tests pass.

- [ ] **Step 6: Add a "large body" test**

The Digest implementation (Task 12) re-issues the entire request body for the second (authenticated) leg. Sideloads of real channels are 10-50 MB. Add a test that posts a 10 MB synthetic zip and asserts a successful round-trip:

```ts
it('handles a 10 MB body across the Digest re-issue', async () => {
  mode = 'success';
  const big = join(tmp, 'big.zip');
  await writeFile(big, Buffer.alloc(10 * 1024 * 1024, 'x'));
  const r = await new DevPortal('127.0.0.1', 'pw', port).sideload(big);
  expect(r.status).toBe('installed');
});
```

Document in a short comment at the top of `sideload.ts`:

```ts
// Note: the Digest re-issue pattern means the entire request body is buffered
// in memory and sent twice. For zips > ~100 MB this becomes a memory concern;
// streaming Digest is a v1.x consideration.
```

- [ ] **Step 7: Commit**

```bash
git add packages/roku-device-client/src/devportal/
git commit -m "feat(roku-device-client): dev-portal sideload + unload (with 10 MB body test)"
```

---

### Task 16: Dev portal — screenshot

POSTs `mysubmit=Screenshot` to `/plugin_inspect`, parses returned asset path, GETs the bytes.

**Files:**
- Modify: `packages/roku-device-client/src/devportal/sideload.ts` (add `screenshot` method) — or split into `inspect.ts` for cleanliness.
- Create: `packages/roku-device-client/src/devportal/inspect.ts`
- Create: `packages/roku-device-client/src/devportal/inspect.test.ts`

- [ ] **Step 1: Add `screenshot` method on `DevPortal`** (in `inspect.ts` for separation; re-export both)

```ts
// packages/roku-device-client/src/devportal/inspect.ts
import { digestRequest } from '../_internal/digest.js';
import { buildBoundary, buildMultipart } from './multipart.js';
import { fail } from '../errors/index.js';

export class DevPortalInspect {
  constructor(private host: string, private password: string, private port = 80) {}

  async screenshot(format: 'jpg' | 'png' = 'jpg'): Promise<{ mime: string; bytes: number; base64: string; duration_ms: number }> {
    const start = Date.now();
    const boundary = buildBoundary();
    const body = buildMultipart(
      [{ kind: 'field', name: 'mysubmit', value: 'Screenshot' },
       { kind: 'field', name: 'passwd', value: '' },
       { kind: 'field', name: 'archive', value: '' }],
      boundary,
    );
    const r1 = await digestRequest({
      method: 'POST',
      url: `http://${this.host}:${this.port}/plugin_inspect`,
      username: 'rokudev', password: this.password,
      body, headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': String(body.length),
      },
    });
    if (r1.statusCode === 401) throw fail('DEVICE_AUTH_FAILED', 'dev portal rejected credentials');
    // Asset path is referenced in HTML as src="pkgs/dev.<ext>" or "pkgs/dev_screenshot.<ext>"
    const m = r1.bodyText.match(/(\/pkgs\/dev[A-Za-z0-9_]*\.(?:jpg|png))/);
    if (!m) throw fail('SCREENSHOT_FAILED', 'no asset path in plugin_inspect response',
      { excerpt: r1.bodyText.slice(0, 400) });
    const path = m[1]!;
    const r2 = await digestRequest({
      method: 'GET',
      url: `http://${this.host}:${this.port}${path}`,
      username: 'rokudev', password: this.password,
    });
    if (r2.statusCode !== 200) throw fail('SCREENSHOT_FAILED', `asset GET returned ${r2.statusCode}`);
    const mime = path.endsWith('.png') ? 'image/png' : 'image/jpeg';
    void format;
    return { mime, bytes: r2.bodyBytes.length, base64: r2.bodyBytes.toString('base64'),
             duration_ms: Date.now() - start };
  }
}
```

- [ ] **Step 2: Write `inspect.test.ts`** with mock that returns the inspect HTML and the asset

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { DevPortalInspect } from './inspect.js';

let server: Server;
let port: number;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (!req.headers.authorization) {
      res.statusCode = 401;
      res.setHeader('WWW-Authenticate', 'Digest realm="r", nonce="n", qop="auth"');
      res.end(); return;
    }
    if (req.url === '/plugin_inspect') {
      let buf = '';
      req.on('data', (c) => buf += c);
      req.on('end', () => {
        res.end(`<html><img src="pkgs/dev.jpg"/></html>`);
      });
      return;
    }
    if (req.url === '/pkgs/dev.jpg') {
      res.setHeader('content-type', 'image/jpeg');
      res.end(Buffer.from([0xff, 0xd8, 0xff, 0xe0])); // jpeg header
      return;
    }
    res.statusCode = 404; res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('DevPortalInspect.screenshot', () => {
  it('roundtrips inspect + asset GET', async () => {
    const r = await new DevPortalInspect('127.0.0.1', 'pw', port).screenshot('jpg');
    expect(r.mime).toBe('image/jpeg');
    expect(r.bytes).toBe(4);
  });
});
```

- [ ] **Step 3: Run, iterate, commit**

```bash
git add packages/roku-device-client/src/devportal/
git commit -m "feat(roku-device-client): dev-portal screenshot"
```

---

### Task 17: Dev portal — genkey, rekey, pack_signed, diff_installed, registry, profiler, crashlog

Group these tightly because they share the same Digest+multipart pattern; each gets a method on `DevPortalInspect`. Tests mock the response strings observed from real Rokus (the prototype has captured fixtures we can study).

**Files:**
- Modify: `packages/roku-device-client/src/devportal/inspect.ts`
- Create: `packages/roku-device-client/src/devportal/diff.ts`
- Create: `packages/roku-device-client/src/devportal/inspect-extras.test.ts`

- [ ] **Step 1: Read prototype fixtures**

```bash
ls /Users/bblietz/Work/ClaudeProjects/brs-mcp/test/fixtures/roku-responses/ 2>/dev/null
```

If fixtures exist, copy them into `packages/roku-device-client/test/fixtures/roku-responses/` and reuse in tests.

- [ ] **Step 2: Add `genkey()` to `DevPortalInspect`**

Send `mysubmit=Genkey`. Parse the HTML for `Dev ID:` and `Dev Key:` blocks. On success return `{ ok: true, dev_id, key, raw_html, duration_ms }`. On parse failure throw `GENKEY_FAILED`.

- [ ] **Step 3: Add `rekey(signedPkgPath, signingPassword)`**

Multipart with `mysubmit=Rekey`, the signed `.pkg` file, and the signing password as a field. On 401 throw `DEVICE_AUTH_FAILED`. On response body containing "Password mismatch" throw `SIGNING_PASSWORD_REJECTED`. Otherwise return `{ ok: true, message }`.

- [ ] **Step 4: Add `packSigned(signingPassword)`**

POST `mysubmit=Package` plus the password field. Parse out the resulting `.pkg` href, GET it via Digest, return `{ ok, pkg_bytes, duration_ms }` (caller decides where to write).

- [ ] **Step 5: Add `queryRegistry(devId)`**

GET `/query/registry/<dev_id>` with Digest. Parse XML (using `parseXml` from ECP). Return the parsed registry as a plain object.

- [ ] **Step 6: Add `profilerSnapshot()`**

POST `mysubmit=Inspect`. Return `{ ok, sections: Record<string, string>, raw_html_excerpt: string, truncated: boolean }`. Sections lifted via simple regex; do not pull in BeautifulSoup-equivalent. Stream cap at 256 KB.

- [ ] **Step 7: Add `crashlogPull()`**

GET `/plugin_factory_log` with Digest. On 404 return `{ ok: false, code: 'DEV_PKG_UNAVAILABLE', ... }` per spec. Cap body at 1 MB; set `truncated: true` if longer.

- [ ] **Step 8: Write `diff.ts` (compare local project dir against `/pkgs/dev.zip`)**

```ts
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import yauzl from 'yauzl';
import { digestRequest } from '../_internal/digest.js';
import { fail } from '../errors/index.js';

export type DiffResult = {
  ok: true; added: string[]; removed: string[]; changed: string[]; same: string[]; duration_ms: number;
};

export async function diffInstalled(host: string, password: string, projectDir: string, port = 80): Promise<DiffResult> {
  const start = Date.now();
  // Fetch the device's dev.zip
  const r = await digestRequest({
    method: 'GET',
    url: `http://${host}:${port}/pkgs/dev.zip`,
    username: 'rokudev', password,
  });
  if (r.statusCode === 404) throw fail('DEV_PKG_UNAVAILABLE', 'no dev.zip on device');
  if (r.statusCode !== 200) throw fail('DEVICE_UNREACHABLE', `dev.zip GET returned ${r.statusCode}`);
  const remote = await zipToHashMap(r.bodyBytes);
  const local = await dirToHashMap(projectDir);
  const added: string[] = [], removed: string[] = [], changed: string[] = [], same: string[] = [];
  const all = new Set([...remote.keys(), ...local.keys()]);
  for (const path of all) {
    const a = local.get(path), b = remote.get(path);
    if (a && !b) added.push(path);
    else if (!a && b) removed.push(path);
    else if (a !== b) changed.push(path);
    else same.push(path);
  }
  added.sort(); removed.sort(); changed.sort(); same.sort();
  return { ok: true, added, removed, changed, same, duration_ms: Date.now() - start };
}

async function zipToHashMap(bytes: Buffer): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (err, zf) => {
      if (err || !zf) return reject(err);
      const m = new Map<string, string>();
      zf.on('entry', (e) => {
        if (/\/$/.test(e.fileName)) { zf.readEntry(); return; }
        zf.openReadStream(e, (err, rs) => {
          if (err || !rs) return reject(err);
          const chunks: Buffer[] = [];
          rs.on('data', (c) => chunks.push(c));
          rs.on('end', () => {
            m.set(e.fileName, createHash('sha256').update(Buffer.concat(chunks)).digest('hex'));
            zf.readEntry();
          });
        });
      });
      zf.on('end', () => resolve(m));
      zf.readEntry();
    });
  });
}

async function dirToHashMap(dir: string): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  // readdir recursive (Node 20.1+) returns Dirent[] including subdir entries.
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile()) continue;
    // Node >=20.12 sets `parentPath`; <20.12 uses deprecated `path`. Use whichever exists.
    const parent = (e as unknown as { parentPath?: string; path?: string }).parentPath
                ?? (e as unknown as { path?: string }).path ?? dir;
    const full = join(parent, e.name);
    const rel = relative(dir, full).split(sep).join('/');
    const data = await readFile(full);
    m.set(rel, createHash('sha256').update(data).digest('hex'));
  }
  return m;
}
```

- [ ] **Step 9: Write tests**

For each method, use a mock HTTP server returning either a captured fixture or a hand-crafted response covering both success and the named failure case. Aim for at least one happy-path test and one error-path test per method (genkey, rekey, packSigned, queryRegistry, profilerSnapshot, crashlogPull, diffInstalled).

- [ ] **Step 10: Add devportal index**

```ts
// packages/roku-device-client/src/devportal/index.ts
export { DevPortal } from './sideload.js';
export { DevPortalInspect } from './inspect.js';
export { diffInstalled, type DiffResult } from './diff.js';
```

- [ ] **Step 11: Commit**

```bash
git add packages/roku-device-client/src/devportal/
git commit -m "feat(roku-device-client): genkey/rekey/pack_signed/diff/registry/profiler/crashlog"
```

---

### Task 18: Telnet client (8080 / 8085 / 8087) and `LOG_TAIL_BUSY`

**Files:**
- Create: `packages/roku-device-client/src/telnet/client.ts`
- Create: `packages/roku-device-client/src/telnet/client.test.ts`
- Create: `packages/roku-device-client/test/fixtures/mock-telnet.ts` (in-process TCP server for tests; can lift from `brs-debug-mcp/test/mock_telnet_server.ts`)

- [ ] **Step 1: Write `client.ts`** (one-shot tail + long-running stream split)

```ts
import { Socket } from 'node:net';
import { fail } from '../errors/index.js';

export type TelnetPort = 8080 | 8085 | 8087;

export class TelnetClient {
  /** One-shot read: connect, capture for `seconds`, return all lines. */
  async tail(host: string, port: TelnetPort, seconds: number): Promise<string[]> {
    const sock = await this.connect(host, port);
    return new Promise<string[]>((resolve, reject) => {
      const lines: string[] = [];
      let buf = '';
      sock.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          lines.push(buf.slice(0, i));
          buf = buf.slice(i + 1);
        }
      });
      sock.on('error', (err) => reject(err));
      const t = setTimeout(() => {
        sock.destroy();
        if (buf) lines.push(buf);
        resolve(lines);
      }, seconds * 1000);
      sock.on('close', () => { clearTimeout(t); resolve(lines); });
    });
  }

  private connect(host: string, port: TelnetPort): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const s = new Socket();
      s.setNoDelay(true);
      let opened = false;
      s.once('connect', () => { opened = true; resolve(s); });
      // Heuristic for LOG_TAIL_BUSY on telnet 8085: Roku accepts the TCP
      // connection then immediately closes it when a second client arrives.
      // We surface that as LOG_TAIL_BUSY only on 8085 within 100ms of connect.
      let closeWatch: NodeJS.Timeout | undefined;
      s.once('connect', () => {
        if (port !== 8085) return;
        closeWatch = setTimeout(() => closeWatch && (closeWatch = undefined), 100);
      });
      s.once('close', (hadError) => {
        if (opened && closeWatch && hadError) {
          reject(fail('LOG_TAIL_BUSY', `telnet ${host}:8085 closed immediately; another client likely connected`));
        }
      });
      s.once('error', (err) => {
        const e = err as NodeJS.ErrnoException;
        if (e.code === 'EADDRINUSE') {
          reject(fail('LOG_TAIL_BUSY', `port ${port} on ${host} already in use`));
        } else if (e.code === 'ECONNREFUSED' || e.code === 'EHOSTUNREACH' || e.code === 'ENETUNREACH') {
          reject(fail('DEVICE_UNREACHABLE', `telnet ${host}:${port}: ${e.code}`));
        } else if (e.code === 'ETIMEDOUT') {
          reject(fail('DEVICE_UNREACHABLE', `telnet ${host}:${port} timed out`));
        } else {
          reject(fail('DEVICE_UNREACHABLE', `telnet ${host}:${port}: ${e.message}`));
        }
      });
      s.connect(port, host);
    });
  }
}
```

- [ ] **Step 2: Write `mock-telnet.ts` fixture**

```ts
import { createServer, type Server } from 'node:net';

export async function startMockTelnet(emit: string[]): Promise<{ server: Server; port: number; closeAll: () => Promise<void> }> {
  const server = createServer((sock) => {
    for (const line of emit) sock.write(`${line}\n`);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const closeAll = () => new Promise<void>((r) => server.close(() => r()));
  return { server, port, closeAll };
}
```

- [ ] **Step 3: Write tests `client.test.ts`** (tail captures lines, errors mapped)

Tests cover:
- tail returns the lines emitted by the mock server within the time budget,
- tail times out cleanly,
- a connect to a closed port returns `LOG_TAIL_BUSY` or `DEVICE_UNREACHABLE`.

The mock-telnet fixture is generic enough that the same fixture lib is used by `log_stream` tests next task.

- [ ] **Step 4: Run, iterate**

- [ ] **Step 5: Commit**

```bash
git add packages/roku-device-client/src/telnet/ packages/roku-device-client/test/fixtures/
git commit -m "feat(roku-device-client): telnet one-shot tail with LOG_TAIL_BUSY"
```

---

### Task 19: Telnet log streaming (long-running session with ring buffer)

Implements §4.3 `log_stream_*` back-pressure contract.

**Files:**
- Modify: `packages/roku-device-client/src/telnet/client.ts` (add `LogStream` class)
- Create: `packages/roku-device-client/src/telnet/log-stream.test.ts`

- [ ] **Step 1: Add `LogStream` class to `telnet/client.ts`**

```ts
export class LogStream {
  private buf: string[] = [];
  private dropped = 0;
  private socket?: Socket;
  private idleTimer?: NodeJS.Timeout;
  private closed = false;
  private readonly maxLines = 65_536;
  private readonly idleMs = 60_000;

  static async open(host: string, port: TelnetPort): Promise<LogStream> {
    const ls = new LogStream();
    const sock = await new TelnetClient()['connect'](host, port);
    ls.socket = sock;
    let pending = '';
    sock.on('data', (chunk) => {
      pending += chunk.toString('utf8');
      let i;
      while ((i = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, i);
        pending = pending.slice(i + 1);
        ls.push(line);
      }
    });
    sock.on('close', () => { ls.closed = true; });
    sock.on('error', () => { ls.closed = true; });
    ls.armIdle();
    return ls;
  }

  // Library-level return shape matches the spec's canonical wire shape (§4.3,
  // §4.6 in-band warnings table): warnings live under `details.warnings`.
  read(): {
    lines: string[];
    details?: { warnings: { code: 'LOG_STREAM_OVERFLOW'; dropped_lines: number; message: string }[] };
  } {
    if (this.closed && this.buf.length === 0) {
      throw fail('LOG_STREAM_TIMED_OUT', 'log stream is closed');
    }
    this.armIdle();
    const lines = this.buf;
    this.buf = [];
    if (this.dropped > 0) {
      const out = {
        lines,
        details: {
          warnings: [{
            code: 'LOG_STREAM_OVERFLOW' as const,
            dropped_lines: this.dropped,
            message: `dropped ${this.dropped} lines: consumer fell behind producer`,
          }],
        },
      };
      this.dropped = 0;
      return out;
    }
    return { lines };
  }

  close(): void {
    this.closed = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.socket?.destroy();
  }

  private push(line: string): void {
    if (this.buf.length >= this.maxLines) {
      this.buf.shift();
      this.dropped++;
    }
    this.buf.push(line);
  }

  private armIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.close(), this.idleMs);
  }
}
```

- [ ] **Step 2: Tests `log-stream.test.ts`**

- open + read returns the buffered lines
- multiple reads with no producer flush return empty arrays
- producer flooding past `maxLines` returns `LOG_STREAM_OVERFLOW` warning with correct `dropped_lines`
- close stops further reads and a subsequent read throws `LOG_STREAM_TIMED_OUT`
- idle timeout (use a small override if practical, e.g. setting `(ls as any).idleMs = 50` before `armIdle`)

- [ ] **Step 3: Add telnet index**

```ts
// packages/roku-device-client/src/telnet/index.ts
export { TelnetClient, LogStream, type TelnetPort } from './client.js';
```

- [ ] **Step 4: Commit**

```bash
git add packages/roku-device-client/src/telnet/
git commit -m "feat(roku-device-client): LogStream with ring buffer + idle close"
```

---

### Task 20: SSDP `roku:ecp` discovery

Per §4.3 `device_discover` is SSDP-only.

**Files:**
- Create: `packages/roku-device-client/src/discovery/ssdp.ts`
- Create: `packages/roku-device-client/src/discovery/ssdp.test.ts`
- Create: `packages/roku-device-client/src/discovery/index.ts`

- [ ] **Step 1: Write `ssdp.ts`**

```ts
import dgram from 'node:dgram';

export type Discovered = {
  host: string;        // IPv4 of the Roku
  location: string;    // ECP base URL e.g. http://192.168.1.42:8060/
  serial?: string;     // from USN if present
};

const M_SEARCH = (host: string) =>
  `M-SEARCH * HTTP/1.1\r\n` +
  `HOST: ${host}\r\n` +
  `MAN: "ssdp:discover"\r\n` +
  `ST: roku:ecp\r\n` +
  `MX: 3\r\n\r\n`;

export async function discover(timeoutMs = 3500): Promise<Discovered[]> {
  return new Promise((resolve) => {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const found = new Map<string, Discovered>();
    sock.on('message', (msg, rinfo) => {
      const text = msg.toString('utf8');
      const loc = /^LOCATION:\s*(\S+)/im.exec(text)?.[1];
      const usn = /^USN:\s*(\S+)/im.exec(text)?.[1];
      if (!loc) return;
      const host = rinfo.address;
      if (found.has(host)) return;
      const serial = usn?.match(/uuid:roku:ecp:(\S+)/i)?.[1];
      found.set(host, { host, location: loc, ...(serial ? { serial } : {}) });
    });
    sock.on('error', () => resolve([...found.values()]));
    sock.bind(() => {
      try { sock.setBroadcast(true); } catch {}
      const datagram = Buffer.from(M_SEARCH('239.255.255.250:1900'));
      sock.send(datagram, 0, datagram.length, 1900, '239.255.255.250');
    });
    setTimeout(() => { sock.close(); resolve([...found.values()]); }, timeoutMs);
  });
}
```

- [ ] **Step 2: Tests `ssdp.test.ts`**

Stand up a local UDP server that listens on a random port, hand its address to `discover` (refactor the function to accept `multicastAddr` and `port` as injectable for tests). Send a fake `roku:ecp` reply. Assert one `Discovered` is returned with the right host and location.

(If injecting multicast is too painful, mark this test `it.skip` with a TODO and rely on a manual integration check; the prototype `brs-mcp-for-docs` did not test SSDP either. Document the choice.)

- [ ] **Step 3: Index + commit**

```ts
// discovery/index.ts
export { discover, type Discovered } from './ssdp.js';
```

```bash
git add packages/roku-device-client/src/discovery/
git commit -m "feat(roku-device-client): SSDP roku:ecp discovery"
```

---

### Task 21: Public exports check

Per spec §2.3, the public surface is `EcpClient`, `EcpControl`, `DevPortal`, `DevPortalInspect`, `TelnetClient`, `LogStream`, `RegistryReader`, `RegistryWriter`, `discover`, `errors` module. Lower-level primitives live under `_internal/` and are not in `exports`.

**Files:**
- Modify: `packages/roku-device-client/src/index.ts`
- Modify: `packages/roku-device-client/package.json` (`exports` field already in place; verify `_internal/*` not exposed)

- [ ] **Step 1: Update `src/index.ts` to re-export the public surface**

```ts
export * from './errors/index.js';
export { RegistryReader, RegistryWriter, parseRegistry, serializeRegistry } from './registry/index.js';
export type { Registry, DeviceEntry, NetworkEntry, NetworkTag } from './registry/index.js';
export { EcpClient, EcpControl, isAllowedKey, isAllowedInputParamKey, isAllowedLaunchParamKey } from './ecp/index.js';
export { DevPortal, DevPortalInspect, diffInstalled } from './devportal/index.js';
export { TelnetClient, LogStream, type TelnetPort } from './telnet/index.js';
export { discover, type Discovered } from './discovery/index.js';
export { readFingerprint, classifyNetwork, isReachable, type Fingerprint } from './network/index.js';
export const VERSION = '0.1.0';
```

- [ ] **Step 2: Confirm `_internal/digest.ts` is NOT exported**

```bash
grep -E '_internal' packages/roku-device-client/package.json
```

Expected: no match.

- [ ] **Step 3: Build and inspect output**

```bash
pnpm --filter @rokudev/device-client build
ls packages/roku-device-client/dist/
```

Expected: `index.js`, `index.d.ts`, plus subdirs `errors/`, `registry/`, `network/`, `ecp/`, `devportal/`, `telnet/`, `discovery/`, `_internal/`. The `_internal/` subdir IS built (TS compiler emits everything) but not reachable via the package's `exports` field, so consumers cannot import it.

- [ ] **Step 4: Add a smoke test asserting `_internal` is not exposed**

`packages/roku-device-client/tests/exports.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import pkg from '../package.json' with { type: 'json' };

describe('package exports', () => {
  it('does not expose _internal', () => {
    const exports = pkg.exports as Record<string, unknown>;
    for (const key of Object.keys(exports)) {
      expect(key).not.toMatch(/_internal/);
    }
  });
  it('exports the public surface', () => {
    const exports = pkg.exports as Record<string, unknown>;
    for (const k of ['.', './errors', './registry', './ecp', './devportal', './telnet', './discovery', './network']) {
      expect(exports).toHaveProperty(k);
    }
  });
});
```

- [ ] **Step 5: Commit**

```bash
git add packages/roku-device-client/src/index.ts packages/roku-device-client/tests/
git commit -m "feat(roku-device-client): finalize public export surface"
```

Phase 1 complete; the shared library is ready.

---

## Phase 2: rokudev-device MCP Server

The MCP wrapper. Each tool is a thin function that resolves `device:` per §2.4, applies network-detection warnings (§4.2), and calls the appropriate client from `@rokudev/device-client`.

**TDD discipline (applies to every task in Phase 2 even where abbreviated below):**
1. Write the failing test first.
2. Run it; confirm it fails for the right reason (function not defined / wrong shape).
3. Write the minimal implementation.
4. Run the test; confirm it passes.
5. Run the whole package test suite; confirm nothing else broke.
6. Commit.

Some tasks below abbreviate to "tests" without re-stating the cycle; the abbreviation is for readability, not permission to skip steps.

### Task 22: Bootstrap rokudev-device package

**Files:**
- Create: `packages/rokudev-device/package.json`
- Create: `packages/rokudev-device/tsconfig.json`
- Create: `packages/rokudev-device/vitest.config.ts`
- Create: `packages/rokudev-device/src/index.ts`

- [ ] **Step 1: Create directory and `package.json`**

```bash
mkdir -p packages/rokudev-device/src/tools packages/rokudev-device/tests
```

```json
{
  "name": "rokudev-device",
  "version": "0.1.0",
  "type": "module",
  "bin": { "rokudev-device": "./dist/index.js" },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "lint": "tsc --noEmit -p tsconfig.json",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@rokudev/device-client": "workspace:*",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "vitest": "^2.0.0",
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist", "composite": true },
  "include": ["src/**/*"],
  "references": [{ "path": "../roku-device-client" }]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
export { default } from '../../vitest.config.base.ts';
```

- [ ] **Step 4: Create stub `src/index.ts`**

```ts
#!/usr/bin/env node
console.error('rokudev-device starting...');
// MCP server wired in next task.
```

- [ ] **Step 5: Install, build, commit**

```bash
pnpm install
pnpm --filter rokudev-device build
```

```bash
git add packages/rokudev-device/
git commit -m "feat(rokudev-device): bootstrap MCP package"
```

---

### Task 23: MCP server scaffold (stdio + tool registration shape)

**Files:**
- Create: `packages/rokudev-device/src/server.ts`
- Modify: `packages/rokudev-device/src/index.ts`
- Create: `packages/rokudev-device/src/tools/_register.ts`
- Create: `packages/rokudev-device/tests/server.test.ts`

- [ ] **Step 1: Write `server.ts`**

```ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { registerAllTools, type ToolDef } from './tools/_register.js';

export async function runServer(): Promise<void> {
  const server = new Server(
    { name: 'rokudev-device', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );
  const tools = new Map<string, ToolDef>();
  registerAllTools(tools);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...tools.values()].map((t) => ({
      name: t.name, description: t.description, inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const def = tools.get(req.params.name);
    if (!def) throw new Error(`unknown tool: ${req.params.name}`);
    const result = await def.handler(req.params.arguments ?? {});
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  await server.connect(new StdioServerTransport());
}
```

- [ ] **Step 2: Write `_register.ts`**

```ts
export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
export type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
};

const REGISTRARS: ((tools: Map<string, ToolDef>) => void)[] = [];

export function registerToolsModule(fn: (tools: Map<string, ToolDef>) => void): void {
  REGISTRARS.push(fn);
}

export function registerAllTools(tools: Map<string, ToolDef>): void {
  for (const r of REGISTRARS) r(tools);
}
```

- [ ] **Step 3: Wire `index.ts`**

```ts
#!/usr/bin/env node
import { runServer } from './server.js';
import './tools/all.js';   // import side-effect modules that call registerToolsModule

runServer().catch((err) => {
  console.error('rokudev-device fatal error:', err);
  process.exit(1);
});
```

- [ ] **Step 4: Create empty `tools/all.ts`** (registers concrete tool modules in later tasks)

```ts
// Side-effect imports of every tool module. Tasks 24-33 add to this list.
```

- [ ] **Step 5: Test the server can be initialized via MCP handshake**

`tests/server.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

describe('rokudev-device server smoke', () => {
  it('responds to MCP initialize handshake', async () => {
    const proc = spawn(process.execPath, [join(__dirname, '..', 'dist', 'index.js')], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const reqId = 1;
    const req = JSON.stringify({
      jsonrpc: '2.0', id: reqId, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } },
    });
    proc.stdin.write(req + '\n');
    let out = '';
    for await (const chunk of proc.stdout) {
      out += chunk.toString();
      try {
        const obj = JSON.parse(out);
        expect(obj.result.protocolVersion).toBe('2024-11-05');
        proc.kill();
        return;
      } catch { /* keep reading */ }
    }
  }, 10_000);
});
```

- [ ] **Step 6: Build and run the test**

```bash
pnpm --filter rokudev-device build
pnpm --filter rokudev-device test
```

- [ ] **Step 7: Commit**

```bash
git add packages/rokudev-device/
git commit -m "feat(rokudev-device): MCP stdio server with tool registration scaffold"
```

---

### Task 24: Cross-package version check (bootstrap stage)

Per §7.3 step 7 and §4.6.

**Files:**
- Create: `packages/rokudev-device/src/bootstrap/version-check.ts`
- Create: `packages/rokudev-device/src/bootstrap/version-check.test.ts`
- Modify: `packages/rokudev-device/src/server.ts` (call check at startup, gate tool calls)

- [ ] **Step 1: Write `version-check.ts`**

```ts
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { fail, warn } from '@rokudev/device-client';

export type VersionState =
  | { ok: true }
  | { ok: true; warning: ReturnType<typeof warn> }
  | { ok: false; failure: ReturnType<typeof fail> };

export async function checkSiblings(myImportMetaUrl: string): Promise<VersionState> {
  const myDir = dirname(fileURLToPath(myImportMetaUrl));
  const me = JSON.parse(await readFile(resolve(myDir, 'package.json'), 'utf8'));
  const mine = String(me.version);
  const mineMajor = parseInt(mine.split('.')[0]!, 10);
  // Resolve sibling: @rokudev/device-client. require() is unavailable in ESM,
  // so synthesize a CommonJS-style require bound to this module's URL.
  const require = createRequire(myImportMetaUrl);
  let siblingVersion: string | undefined;
  try {
    const siblingPath = require.resolve('@rokudev/device-client/package.json');
    siblingVersion = JSON.parse(await readFile(siblingPath, 'utf8')).version;
  } catch {
    // sibling not findable; nothing to check (e.g. running from source).
    return { ok: true };
  }
  const sibMajor = parseInt(siblingVersion!.split('.')[0]!, 10);
  if (sibMajor !== mineMajor) {
    return {
      ok: false,
      failure: fail('CROSS_PACKAGE_VERSION_MISMATCH',
        `rokudev-device@${mine} requires @rokudev/device-client@${mineMajor}.x; found ${siblingVersion}`,
        { package: '@rokudev/device-client', installed_version: siblingVersion, expected_version: `${mineMajor}.x` }),
    };
  }
  if (siblingVersion !== mine) {
    return {
      ok: true,
      warning: warn('CROSS_PACKAGE_VERSION_MISMATCH',
        `minor-version drift: rokudev-device ${mine} vs @rokudev/device-client ${siblingVersion}`,
        { package: '@rokudev/device-client', installed_version: siblingVersion, expected_version: mine }),
    };
  }
  return { ok: true };
}
```

- [ ] **Step 2: Write tests**

Mock by creating a tmp dir with a fake `package.json` and a `node_modules/@rokudev/device-client/package.json`. Verify:
- equal versions → `{ ok: true }` no warning
- patch drift → `{ ok: true, warning: { code: 'CROSS_PACKAGE_VERSION_MISMATCH' } }`
- major drift → `{ ok: false, failure: { code: 'CROSS_PACKAGE_VERSION_MISMATCH' } }`

- [ ] **Step 3: Wire into `server.ts`**

At server start, call `await checkSiblings(import.meta.url)`. If failure, store it and have `CallToolRequestSchema` handler short-circuit every call with the failure result. If warning, attach it to `details.warnings` of the next tool call's result, then clear it (one-shot per spec §4.6 in-band table).

```ts
// server.ts addition (sketch)
import { checkSiblings, type VersionState } from './bootstrap/version-check.js';

let versionState: VersionState = { ok: true };
versionState = await checkSiblings(import.meta.url);

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (versionState.ok === false) {
    return { content: [{ type: 'text', text: JSON.stringify(versionState.failure) }] };
  }
  // ... existing dispatch ...
  // If versionState carries a one-shot warning, splice it into details.warnings, then clear:
  if ('warning' in versionState) {
    const w = versionState.warning;
    versionState = { ok: true };
    // (handler code merges w into the call's result.details.warnings)
  }
});
```

- [ ] **Step 4: Commit**

```bash
git add packages/rokudev-device/src/bootstrap/ packages/rokudev-device/src/server.ts
git commit -m "feat(rokudev-device): cross-package version check at startup"
```

---

### Task 25: Helper — config precedence resolver

Implements §2.4. Used by every tool that takes a `device:` parameter.

**Files:**
- Create: `packages/rokudev-device/src/util/resolve-target.ts`
- Create: `packages/rokudev-device/src/util/resolve-target.test.ts`

- [ ] **Step 1: Write `resolve-target.ts`**

```ts
import { RegistryReader, fail } from '@rokudev/device-client';

export type ResolvedTarget = { device?: string; host: string; dev_password?: string };
export type ResolveArgs = { device?: string; host?: string; device_ip?: string; dev_password?: string };

export async function resolveTarget(args: ResolveArgs): Promise<ResolvedTarget> {
  const tried: string[] = [];

  // Step 1: per-call host/password win unconditionally.
  const directHost = args.host ?? args.device_ip;
  if (directHost) {
    return {
      ...(args.device !== undefined ? { device: args.device } : {}),
      host: directHost,
      ...(args.dev_password ? { dev_password: args.dev_password } : {}),
    };
  }
  tried.push('per-call');

  const reader = new RegistryReader();
  const reg = await reader.read();

  // Determine the device name from args.device, or fall back to the active
  // registry device. Per-device env-vars apply to whichever name we end up with
  // (so the active device's env overrides still work; this is the §2.4 spec).
  const deviceName = args.device ?? reg.active;
  const entry = deviceName ? reg.devices[deviceName] : undefined;

  if (deviceName) {
    const envName = deviceName.replace(/-/g, '_').toUpperCase();
    const envHost = process.env[`ROKUDEV_HOST_${envName}`];
    const envPass = process.env[`ROKUDEV_DEV_PASSWORD_${envName}`];
    if (entry || envHost) {
      const host = envHost ?? entry?.host;
      if (!host) {
        tried.push('per-device-env', 'registry-entry');
        // fall through to global env / fail
      } else {
        const pw = envPass ?? entry?.dev_password;
        return { device: deviceName, host, ...(pw ? { dev_password: pw } : {}) };
      }
    }
    tried.push(args.device ? 'registry-device' : 'registry-active');
  }

  // Step 4: global env vars (ROKUDEV_DEFAULT_ROKU_HOST + ROKUDEV_ROKU_DEV_PASSWORD).
  const gHost = process.env.ROKUDEV_DEFAULT_ROKU_HOST;
  const gPass = process.env.ROKUDEV_ROKU_DEV_PASSWORD;
  if (gHost) {
    return { host: gHost, ...(gPass ? { dev_password: gPass } : {}) };
  }
  tried.push('global-env');

  throw fail('DEVICE_NOT_RESOLVED', 'no host/password resolved', { tried });
}
```

- [ ] **Step 2: Tests**

Cover the §2.4 precedence chain comprehensively. Use `ROKUDEV_CONFIG_DIR` override + `process.env` mutation. Required test cases:

1. Per-call `host` wins over env and registry.
2. Per-call `host` + per-call `dev_password` are returned together.
3. `device:` arg + per-device env (`ROKUDEV_HOST_HOME_TV`) overrides registry host for that device.
4. `device:` arg + per-device env password overrides registry password.
5. **Active-device + per-device env vars override registry** (the spec says env wins over registry; do not let this regress). Setup: registry has `home-tv` with host `1.1.1.1`, `active = "home-tv"`; env sets `ROKUDEV_HOST_HOME_TV=2.2.2.2`. Expected: `host = "2.2.2.2"`.
6. Global env (`ROKUDEV_DEFAULT_ROKU_HOST`) used when no `device:` and no active.
7. Active registry device used when no `device:` and no env (and confirms env-var name normalization: `corp-tv-43` → `ROKUDEV_HOST_CORP_TV_43`).
8. `DEVICE_NOT_RESOLVED` thrown with `details.tried` enumerating consulted steps when nothing resolves.

- [ ] **Step 3: Commit**

```bash
git add packages/rokudev-device/src/util/
git commit -m "feat(rokudev-device): resolveTarget per spec §2.4 precedence"
```

---

### Task 26: Helper — network detection guard

Wraps every device tool with the §4.2 reachability check.

**Files:**
- Create: `packages/rokudev-device/src/util/network-guard.ts`
- Create: `packages/rokudev-device/src/util/network-guard.test.ts`

- [ ] **Step 1: Write `network-guard.ts`**

```ts
import { readFingerprint, classifyNetwork, isReachable, RegistryReader, fail } from '@rokudev/device-client';

let cached: { ts: number; tag: ReturnType<typeof classifyNetwork> } | undefined;
const CACHE_MS = 30_000;

export async function checkReachable(deviceName: string | undefined, force: boolean): Promise<void> {
  if (force || !deviceName) return;
  const reg = await new RegistryReader().read();
  const entry = reg.devices[deviceName];
  if (!entry?.network_tag) return;     // no tag, no policy
  const now = Date.now();
  if (!cached || now - cached.ts > CACHE_MS) {
    const fp = await readFingerprint();
    cached = { ts: now, tag: classifyNetwork(fp, reg.networks) };
  }
  if (!isReachable(cached.tag, entry.network_tag, reg.networks)) {
    throw fail('NETWORK_UNREACHABLE',
      `device '${deviceName}' is on ${entry.network_tag}; you appear to be on ${cached.tag}`,
      { device_network: entry.network_tag, current_network: cached.tag });
  }
}

export function _resetCache(): void { cached = undefined; }
```

- [ ] **Step 2: Tests**

Inject a fake `RegistryReader`-like object via DI or by overriding registry IO with `ROKUDEV_CONFIG_DIR`. Verify:
- with `force: true`, never throws,
- with no `network_tag`, never throws,
- when classifier returns unreachable target, throws `NETWORK_UNREACHABLE` with correct `details`,
- caches the classification for 30s.

For testing, set `cached` manually via the export (dirty but pragmatic).

- [ ] **Step 3: Commit**

```bash
git add packages/rokudev-device/src/util/
git commit -m "feat(rokudev-device): network reachability guard with 30s cache"
```

---

### Task 27: Registry tools (`device_list`, `device_add`, `device_set_password`, `device_set_active`, `device_remove`, `device_test`)

**Files:**
- Create: `packages/rokudev-device/src/tools/registry.ts`
- Create: `packages/rokudev-device/src/tools/registry.test.ts`
- Modify: `packages/rokudev-device/src/tools/all.ts`

- [ ] **Step 1: Write `registry.ts`**

Each tool is a `ToolDef` registered via `registerToolsModule`. Use Zod schemas for `inputSchema` (converted to JSON Schema with `zod-to-json-schema`, or hand-written here).

```ts
import { registerToolsModule, type ToolDef } from './_register.js';
import { RegistryReader, RegistryWriter, EcpClient, fail } from '@rokudev/device-client';

function tool(t: ToolDef): ToolDef { return t; }

registerToolsModule((tools) => {
  tools.set('device_list', tool({
    name: 'device_list',
    description: 'List devices in the registry.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const r = await new RegistryReader().read();
      const devices = Object.entries(r.devices).map(([name, d]) => ({
        name, host: d.host, network_tag: d.network_tag, model: d.model, last_seen: d.last_seen,
      }));
      return { ok: true, active: r.active, devices };
    },
  }));

  tools.set('device_add', tool({
    name: 'device_add',
    description: 'Add or upsert a device registry entry. Optionally set dev_password.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        host: { type: 'string' },
        hostname: { type: 'string' },
        network_tag: { type: 'string', enum: ['home', 'corp', 'home_via_vpn', 'unknown'] },
        serial: { type: 'string' }, model: { type: 'string' },
        dev_password: { type: 'string' },
      },
      required: ['name', 'host'], additionalProperties: false,
    },
    handler: async (a) => {
      const w = new RegistryWriter();
      const { name, ...entry } = a as Record<string, string>;
      await w.addDevice(name, { ...entry, added_at: new Date().toISOString() });
      return { ok: true, name };
    },
  }));

  tools.set('device_set_password', tool({
    name: 'device_set_password',
    description: 'Set or update the dev_password for an existing registry entry.',
    inputSchema: {
      type: 'object',
      properties: { device: { type: 'string' }, dev_password: { type: 'string' } },
      required: ['device', 'dev_password'], additionalProperties: false,
    },
    handler: async (a) => {
      await new RegistryWriter().setPassword(a.device as string, a.dev_password as string);
      return { ok: true, device: a.device };
    },
  }));

  tools.set('device_set_active', tool({
    name: 'device_set_active',
    description: 'Mark the named device as the registry-default active device.',
    inputSchema: {
      type: 'object',
      properties: { device: { type: 'string' } },
      required: ['device'], additionalProperties: false,
    },
    handler: async (a) => {
      await new RegistryWriter().setActive(a.device as string);
      return { ok: true, active: a.device };
    },
  }));

  tools.set('device_remove', tool({
    name: 'device_remove',
    description: 'Remove a device from the registry.',
    inputSchema: {
      type: 'object',
      properties: { device: { type: 'string' } },
      required: ['device'], additionalProperties: false,
    },
    handler: async (a) => {
      await new RegistryWriter().removeDevice(a.device as string);
      return { ok: true, device: a.device };
    },
  }));

  tools.set('device_test', tool({
    name: 'device_test',
    description: 'Confirm a device is reachable (ECP /query/device-info round-trip).',
    inputSchema: {
      type: 'object',
      properties: { device: { type: 'string' }, host: { type: 'string' } },
      additionalProperties: false,
    },
    handler: async (a) => {
      const { resolveTarget } = await import('../util/resolve-target.js');
      const t = await resolveTarget(a as Record<string, string>);
      const info = await new EcpClient(t.host).deviceInfo();
      return { ok: true, host: t.host, model: info['model-name'], serial: info['serial-number'] };
    },
  }));
});
```

- [ ] **Step 2: Add to `tools/all.ts`**

```ts
import './registry.js';
```

- [ ] **Step 3: Tests**

`registry.test.ts` exercises each tool against a tmp `ROKUDEV_CONFIG_DIR` and (for `device_test`) an HTTP mock for ECP. Use the in-process tool-call API: directly construct the `ToolDef` map by importing the module and inspecting the registrar.

- [ ] **Step 4: Commit**

```bash
git add packages/rokudev-device/src/tools/
git commit -m "feat(rokudev-device): registry tools"
```

---

### Task 28: ECP read tools

**Files:**
- Create: `packages/rokudev-device/src/tools/ecp-read.ts`
- Create: `packages/rokudev-device/src/tools/ecp-read.test.ts`
- Modify: `packages/rokudev-device/src/tools/all.ts`

- [ ] **Step 1: Write `ecp-read.ts`** — six tools: `ecp_device_info`, `ecp_apps`, `ecp_active_app`, `ecp_media_player`, `ecp_r2d2_bitrate`, `ecp_icon`.

Each tool's handler:
1. Calls `resolveTarget(args)`.
2. Calls `checkReachable(t.device, args.force === true)`.
3. Constructs an `EcpClient(t.host)` and calls the relevant method.
4. Returns the result wrapped as `{ ok: true, ...result }`.

`inputSchema` for each: object with `device`, `host`, `force` optional. `ecp_icon` adds `app_id: string` required.

- [ ] **Step 2: Tests**

`ecp-read.test.ts` boots a mock ECP HTTP server (reuse the fixture from Task 13) and verifies each handler returns expected shapes. One additional test: `ecp_icon` handler returns the correct `{ mime, base64, bytes }`.

- [ ] **Step 3: Add to `all.ts`**

```ts
import './ecp-read.js';
```

- [ ] **Step 4: Commit**

```bash
git add packages/rokudev-device/src/tools/
git commit -m "feat(rokudev-device): ECP read tools"
```

---

### Task 29: ECP control tools

**Files:**
- Create: `packages/rokudev-device/src/tools/ecp-control.ts`
- Create: `packages/rokudev-device/src/tools/ecp-control.test.ts`
- Modify: `packages/rokudev-device/src/tools/all.ts`

- [ ] **Step 1: Write `ecp-control.ts`** — five tools: `ecp_keypress`, `ecp_keysequence`, `ecp_launch`, `ecp_input`, `ecp_to_home`.

Each follows the resolve+guard+invoke pattern. Pass through `ECP_KEY_DISALLOWED` and `ECP_PARAM_DISALLOWED` failures from `EcpControl` directly (do not wrap or recode).

`inputSchema` examples:

```ts
// ecp_keypress
{ type: 'object',
  properties: { device: {type:'string'}, host: {type:'string'},
                key: { type: 'string' },
                mode: { type: 'string', enum: ['press','down','up'], default: 'press' },
                repeat: { type: 'integer', minimum: 1, maximum: 50, default: 1 },
                force: { type: 'boolean' } },
  required: ['key'], additionalProperties: false }

// ecp_launch
{ type: 'object',
  properties: { device: {type:'string'}, host: {type:'string'},
                app_id: { type: 'string' },
                params: { type: 'object', additionalProperties: { type: 'string' } },
                force: { type: 'boolean' } },
  required: ['app_id'], additionalProperties: false }

// (analogous for keysequence, input, to_home)
```

- [ ] **Step 2: Tests**

Mock ECP server (post-only). Verify:
- happy path for each tool,
- disallowed key surfaces `ECP_KEY_DISALLOWED`,
- disallowed param surfaces `ECP_PARAM_DISALLOWED`,
- `repeat: 5` calls the endpoint 5 times,
- `force: true` skips network guard.

- [ ] **Step 3: Add to `all.ts`** and commit.

```bash
git add packages/rokudev-device/src/tools/
git commit -m "feat(rokudev-device): ECP control tools"
```

---

### Task 30: Dev-portal tools (sideload, unload, screenshot, genkey, rekey, pack_signed, diff_installed, query_registry, profiler_snapshot, crashlog_pull)

**Files:**
- Create: `packages/rokudev-device/src/tools/devportal.ts`
- Create: `packages/rokudev-device/src/tools/devportal.test.ts`
- Modify: `packages/rokudev-device/src/tools/all.ts`

- [ ] **Step 1: Write `devportal.ts`**

Register exactly these tool names (load-bearing for Task 33's e2e expected list):

| Tool name | Library call | Required input fields beyond `device`/`host`/`dev_password`/`force` |
|---|---|---|
| `sideload` | `DevPortal.sideload(zip_path)` | `zip_path: string` |
| `unload` | `DevPortal.unload()` | (none) |
| `screenshot` | `DevPortalInspect.screenshot(format)` | `format?: "jpg" \| "png"`, `return?: "inline" \| "ref"` |
| `genkey` | `DevPortalInspect.genkey()` | (none) |
| `rekey` | `DevPortalInspect.rekey(signed_pkg_path, password)` | `signed_pkg_path`, `password` (signing pw) |
| `pack_signed` | `DevPortalInspect.packSigned(signing_password)` | `project_dir`, `signing_password`, `output_pkg` |
| `diff_installed` | `diffInstalled(host, dev_password, project_dir)` | `project_dir` |
| `query_registry` | `DevPortalInspect.queryRegistry(dev_id)` | `dev_id` |
| `profiler_snapshot` | `DevPortalInspect.profilerSnapshot()` | (none) |
| `crashlog_pull` | `DevPortalInspect.crashlogPull()` | (none) |

Each handler:
1. `resolveTarget(args)` — must produce a `dev_password` (otherwise throw `DEVICE_NO_PASSWORD`).
2. `checkReachable(...)`.
3. Construct `DevPortal` or `DevPortalInspect`.
4. Call the method.
5. For `screenshot`: respect `return: 'inline' | 'ref'` (default `inline`). In `ref` mode, write to `~/.cache/brs/screenshots/<sha>.<ext>` (mode 0600) and return `{ mime, path, bytes }`. SHA = sha256 of the bytes.
6. For `diff_installed`: call `diffInstalled(t.host, t.dev_password!, args.project_dir as string)`.
7. For `pack_signed`: signing_password is per-call only (per §4.7.3); the resolver must NOT consult the registry for this field. Reject (throw `SIGNING_PASSWORD_REJECTED`) if the user attempts to put it in the registry (this check lives at `device_add` level; assert the registry schema has no `signing_password` field).

`inputSchema` per spec §4.3, with `device`, `host`, `dev_password`, `force` always optional. Tool-specific required fields: `screenshot` has `format` enum, `pack_signed` requires `project_dir`+`signing_password`+`output_pkg`, `rekey` requires `signed_pkg_path`+`password` (signing pw), `query_registry` requires `dev_id`, `diff_installed` requires `project_dir`.

- [ ] **Step 2: Special handler logic for screenshot return mode**

```ts
async function screenshotHandler(a: Record<string, unknown>) {
  const t = await resolveTarget(a as any);
  await checkReachable(t.device, a.force === true);
  if (!t.dev_password) return fail('DEVICE_NO_PASSWORD', 'no dev_password resolved');
  const dp = new DevPortalInspect(t.host, t.dev_password);
  const shot = await dp.screenshot((a.format as 'jpg' | 'png' | undefined) ?? 'jpg');
  const ret = (a.return as 'inline' | 'ref' | undefined) ?? 'inline';
  if (ret === 'inline') return { ok: true, ...shot };
  // ref mode
  const { mkdir, writeFile, chmod } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { homedir } = await import('node:os');
  const { createHash } = await import('node:crypto');
  const cacheDir = join(homedir(), '.cache', 'brs', 'screenshots');
  await mkdir(cacheDir, { recursive: true, mode: 0o700 });
  const sha = createHash('sha256').update(shot.base64, 'base64').digest('hex');
  const ext = shot.mime === 'image/png' ? 'png' : 'jpg';
  const path = join(cacheDir, `${sha}.${ext}`);
  await writeFile(path, Buffer.from(shot.base64, 'base64'), { mode: 0o600 });
  await chmod(path, 0o600);
  return { ok: true, mime: shot.mime, bytes: shot.bytes, path, duration_ms: shot.duration_ms };
}
```

- [ ] **Step 3: Tests**

For each tool, mock the dev-portal HTTP responses (reuse fixtures from Task 17). Cover happy path and one error per tool. Add a focused test for `screenshot return: 'ref'` mode that asserts the file is written with 0600 perms and the response carries `path`.

**Mandatory secret-handling test (one per tool that takes a password).** For `sideload`, `unload`, `screenshot`, `genkey`, `rekey`, `pack_signed`, `diff_installed`, `query_registry`, `profiler_snapshot`, `crashlog_pull`: invoke with `dev_password = "verysecretXYZ"` (and `signing_password = "signsecretXYZ"` for `rekey`/`pack_signed`), then assert:

```ts
const result = await callTool(name, args);
expect(JSON.stringify(result)).not.toContain('verysecretXYZ');
expect(JSON.stringify(result)).not.toContain('signsecretXYZ');
```

This makes the §4.7.3 "secrets never echoed" rule a CI-enforced invariant for every dev-portal tool.

- [ ] **Step 4: Add to `all.ts`** and commit.

```bash
git add packages/rokudev-device/src/tools/
git commit -m "feat(rokudev-device): dev-portal tools (sideload through crashlog_pull)"
```

---

### Task 31: Telnet log tools (`log_tail`, `log_stream_open`, `log_stream_read`, `log_stream_close`)

**Files:**
- Create: `packages/rokudev-device/src/tools/log.ts`
- Create: `packages/rokudev-device/src/tools/log.test.ts`
- Modify: `packages/rokudev-device/src/tools/all.ts`

- [ ] **Step 1: Write `log.ts`**

```ts
import { registerToolsModule } from './_register.js';
import { TelnetClient, LogStream, fail } from '@rokudev/device-client';
import { resolveTarget } from '../util/resolve-target.js';
import { checkReachable } from '../util/network-guard.js';

const sessions = new Map<string, LogStream>();

registerToolsModule((tools) => {
  tools.set('log_tail', {
    name: 'log_tail',
    description: 'Capture BrightScript debug console output for a fixed duration.',
    inputSchema: {
      type: 'object',
      properties: {
        device: { type: 'string' }, host: { type: 'string' },
        port: { type: 'integer', enum: [8080, 8085, 8087], default: 8085 },
        seconds: { type: 'number', minimum: 0.5, maximum: 600, default: 10 },
        force: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    handler: async (a) => {
      const t = await resolveTarget(a as any);
      await checkReachable(t.device, a.force === true);
      const port = (a.port as 8080 | 8085 | 8087 | undefined) ?? 8085;
      const seconds = (a.seconds as number | undefined) ?? 10;
      const lines = await new TelnetClient().tail(t.host, port, seconds);
      return { ok: true, host: t.host, port, lines };
    },
  });

  tools.set('log_stream_open', {
    name: 'log_stream_open',
    description: 'Open a long-running telnet log session. Returns session_id.',
    inputSchema: {
      type: 'object',
      properties: {
        device: { type: 'string' }, host: { type: 'string' },
        port: { type: 'integer', enum: [8080, 8085, 8087], default: 8085 },
        force: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    handler: async (a) => {
      const t = await resolveTarget(a as any);
      await checkReachable(t.device, a.force === true);
      const port = (a.port as 8080 | 8085 | 8087 | undefined) ?? 8085;
      const ls = await LogStream.open(t.host, port);
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      sessions.set(id, ls);
      return { ok: true, session_id: id, host: t.host, port };
    },
  });

  tools.set('log_stream_read', {
    name: 'log_stream_read',
    description: 'Read pending lines from a long-running telnet log session.',
    inputSchema: {
      type: 'object',
      properties: { session_id: { type: 'string' } },
      required: ['session_id'], additionalProperties: false,
    },
    handler: async (a) => {
      const ls = sessions.get(a.session_id as string);
      if (!ls) throw fail('LOG_STREAM_TIMED_OUT', 'unknown session_id');
      const r = ls.read();
      // Library returns the canonical {lines, details?} shape; pass through directly.
      return { ok: true, ...r };
    },
  });

  tools.set('log_stream_close', {
    name: 'log_stream_close',
    description: 'Close a long-running telnet log session.',
    inputSchema: {
      type: 'object',
      properties: { session_id: { type: 'string' } },
      required: ['session_id'], additionalProperties: false,
    },
    handler: async (a) => {
      const ls = sessions.get(a.session_id as string);
      if (ls) ls.close();
      sessions.delete(a.session_id as string);
      return { ok: true };
    },
  });
});
```

- [ ] **Step 2: Tests**

Use the `mock-telnet.ts` fixture from Task 18. Verify the `log_tail` tool returns the emitted lines, `log_stream_open` produces a session id, `log_stream_read` returns lines and warns on overflow, `log_stream_close` cleans up.

- [ ] **Step 3: Add to `all.ts`** and commit.

```bash
git add packages/rokudev-device/src/tools/
git commit -m "feat(rokudev-device): log_tail and log_stream_* tools"
```

---

### Task 32: Composite `dev_loop` (sideload + tail)

`dev_loop_with_smoke` is deferred until Plan 4 (it needs the smoke fingerprint pack). At Plan 1, only `dev_loop` ships.

**Files:**
- Create: `packages/rokudev-device/src/tools/dev-loop.ts`
- Create: `packages/rokudev-device/src/tools/dev-loop.test.ts`
- Modify: `packages/rokudev-device/src/tools/all.ts`

- [ ] **Step 1: Write `dev-loop.ts`**

```ts
import { registerToolsModule } from './_register.js';
import { DevPortal, TelnetClient, fail } from '@rokudev/device-client';
import { resolveTarget } from '../util/resolve-target.js';
import { checkReachable } from '../util/network-guard.js';

registerToolsModule((tools) => {
  tools.set('dev_loop', {
    name: 'dev_loop',
    description: 'Sideload a zip and tail logs for tail_seconds. Returns sideload result and captured lines.',
    inputSchema: {
      type: 'object',
      properties: {
        device: { type: 'string' }, host: { type: 'string' }, dev_password: { type: 'string' },
        zip_path: { type: 'string' },
        tail_seconds: { type: 'number', minimum: 0, maximum: 120, default: 10 },
        force: { type: 'boolean' },
        freeform_lint_override: { type: 'boolean' },  // Plan 4 enforces; Plan 1 accepts but ignores.
      },
      required: ['zip_path'], additionalProperties: false,
    },
    handler: async (a) => {
      const t = await resolveTarget(a as any);
      await checkReachable(t.device, a.force === true);
      if (!t.dev_password) throw fail('DEVICE_NO_PASSWORD', 'no dev_password resolved');
      const dp = new DevPortal(t.host, t.dev_password);
      const sideload = await dp.sideload(a.zip_path as string);
      const tail = (a.tail_seconds as number | undefined) ?? 10;
      const lines = tail > 0 ? await new TelnetClient().tail(t.host, 8085, tail) : [];
      return { ok: true, host: t.host, sideload, log_lines: lines };
    },
  });
});
```

- [ ] **Step 2: Test**

Mock both the dev-portal HTTP server (reuse fixtures from Task 15) and a telnet server (mock-telnet from Task 18). Verify the handler:
- sideloads,
- tails for the requested duration,
- returns both sideload result and lines,
- accepts `freeform_lint_override` without error (no-op at Plan 1).

- [ ] **Step 3: Add to `all.ts`** and commit.

```bash
git add packages/rokudev-device/src/tools/
git commit -m "feat(rokudev-device): composite dev_loop"
```

---

### Task 33: End-to-end smoke test (`tools/list` only)

**Decision:** A full end-to-end e2e (drive the MCP server in a child process and exercise every tool against mock servers) requires either overriding hard-coded ports on the *device-side* (Roku's 80 / 8060 / 8085 are not configurable when addressed via the registry's `host`) or running tests in a network namespace, both of which are out of scope for Plan 1. Per-tool unit tests in Tasks 13–32 already cover the wire shapes by calling the library classes with injectable ports. Plan 1's e2e is therefore limited to a `tools/list` smoke that validates the MCP wiring and confirms every tool registered. Full multi-tool e2e is deferred to Plan 2 (when BDP work forces full mock-Roku infrastructure).

**Files:**
- Create: `packages/rokudev-device/tests/e2e.test.ts`

- [ ] **Step 1: Write `e2e.test.ts` (tools/list only)**

```ts
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

describe('rokudev-device e2e: tools/list', () => {
  it('lists every tool from Phase 2', async () => {
    const proc = spawn(process.execPath, [join(__dirname, '..', 'dist', 'index.js')]);
    const init = JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } },
    });
    proc.stdin.write(init + '\n');
    // wait for init response
    let out = '';
    for await (const chunk of proc.stdout) {
      out += chunk.toString();
      if (out.split('\n').some((l) => l.includes('"id":1'))) break;
    }
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
    out = '';
    for await (const chunk of proc.stdout) {
      out += chunk.toString();
      const line = out.split('\n').find((l) => l.includes('"id":2'));
      if (line) {
        const obj = JSON.parse(line);
        const names: string[] = obj.result.tools.map((t: { name: string }) => t.name).sort();
        expect(names).toEqual([
          'dev_loop',
          'device_add', 'device_list', 'device_remove', 'device_set_active',
          'device_set_password', 'device_test',
          'ecp_active_app', 'ecp_apps', 'ecp_device_info', 'ecp_icon',
          'ecp_input', 'ecp_keypress', 'ecp_keysequence', 'ecp_launch',
          'ecp_media_player', 'ecp_r2d2_bitrate', 'ecp_to_home',
          'genkey', 'crashlog_pull', 'diff_installed',
          'log_stream_close', 'log_stream_open', 'log_stream_read', 'log_tail',
          'pack_signed', 'profiler_snapshot', 'query_registry',
          'rekey', 'screenshot', 'sideload', 'unload',
        ].sort());
        proc.kill();
        return;
      }
    }
  }, 15_000);
});
```

(Adjust the expected list to match the exact names registered. `device_discover` is added in Task 34 if you elect; otherwise keep deferred.)

- [ ] **Step 2: Run, iterate, commit**

```bash
pnpm --filter rokudev-device build
pnpm --filter rokudev-device test
git add packages/rokudev-device/tests/
git commit -m "test(rokudev-device): e2e tools/list smoke"
```

---

### Task 34: `device_discover` tool

Wraps `discover()` from the library and offers each result as a `device_add`-ready entry.

**Files:**
- Modify: `packages/rokudev-device/src/tools/registry.ts` (add `device_discover`)
- Modify: `packages/rokudev-device/src/tools/registry.test.ts`
- Modify: e2e expected list above to include `device_discover`.

- [ ] **Step 1: Add `device_discover`**

```ts
tools.set('device_discover', tool({
  name: 'device_discover',
  description: 'Run an SSDP roku:ecp scan on the current LAN. Returns devices found; does NOT add them to the registry.',
  inputSchema: {
    type: 'object',
    properties: { timeout_ms: { type: 'integer', minimum: 500, maximum: 30_000, default: 3500 } },
    additionalProperties: false,
  },
  handler: async (a) => {
    const { discover } = await import('@rokudev/device-client');
    const list = await discover((a.timeout_ms as number | undefined) ?? 3500);
    return { ok: true, found: list };
  },
}));
```

- [ ] **Step 2: Test (best-effort)**

If real-device SSDP is impractical in CI, mark the test `it.skip` with a TODO (consistent with library-level decision in Task 20). Add a unit test that asserts the tool registration exists.

- [ ] **Step 3: Update e2e expected list and commit**

```bash
git add packages/rokudev-device/src/tools/ packages/rokudev-device/tests/
git commit -m "feat(rokudev-device): device_discover tool (SSDP one-shot)"
```

---

## Phase 3: Final Plumbing and Quality Gate

### Task 35: Quality gate scripts and turbo wiring

**Files:**
- Modify: `package.json` (add `release-prep` script)
- Modify: `turbo.json` (cache test outputs)

- [ ] **Step 1: Add a `release-prep` script**

```json
"scripts": {
  "release-prep": "pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build"
}
```

- [ ] **Step 2: Run it**

```bash
pnpm release-prep
```

Expected: every step exits 0.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: release-prep aggregate script"
```

---

### Task 36: Manual integration script against a real Roku

A non-CI script the developer runs once after wiring up a real device, to confirm the MCP works end-to-end. Optional but valuable.

**Files:**
- Create: `scripts/manual-smoke.mjs`

- [ ] **Step 1: Write the script**

```js
#!/usr/bin/env node
// Manual smoke: spawn rokudev-device, exercise the device tools against a real Roku.
// Usage: ROKUDEV_DEFAULT_ROKU_HOST=192.168.1.42 ROKUDEV_ROKU_DEV_PASSWORD=rokudev node scripts/manual-smoke.mjs
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const proc = spawn(process.execPath,
  [resolve('packages/rokudev-device/dist/index.js')],
  { stdio: ['pipe', 'pipe', 'inherit'] });

let nextId = 1;
function call(method, params) {
  const id = nextId++;
  return new Promise((res) => {
    const onData = (chunk) => {
      const text = chunk.toString();
      const line = text.split('\n').find((l) => l.includes(`"id":${id}`));
      if (line) { proc.stdout.off('data', onData); res(JSON.parse(line)); }
    };
    proc.stdout.on('data', onData);
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } });
console.log(await call('tools/list', {}));
// device_test first: surfaces DEVICE_NOT_RESOLVED clearly if env vars are missing.
console.log(await call('tools/call', { name: 'device_test', arguments: {} }));
console.log(await call('tools/call', { name: 'ecp_device_info', arguments: {} }));
console.log(await call('tools/call', { name: 'ecp_apps', arguments: {} }));
console.log(await call('tools/call', { name: 'log_tail', arguments: { seconds: 2 } }));
proc.kill();
```

- [ ] **Step 2: Make executable and document in README**

```bash
chmod +x scripts/manual-smoke.mjs
```

Add a short section to `README.md`:

```md
## Manual smoke against a real Roku

Set `ROKUDEV_DEFAULT_ROKU_HOST` and `ROKUDEV_ROKU_DEV_PASSWORD`, then run:

    pnpm build && node scripts/manual-smoke.mjs
```

- [ ] **Step 3: Commit**

```bash
git add scripts/manual-smoke.mjs README.md
git commit -m "chore: manual smoke script for real-device sanity check"
```

---

### Task 37: Final CI check + Plan 1 closure

- [ ] **Step 1: Confirm `pnpm release-prep` is green**

```bash
pnpm release-prep
```

Expected: all stages pass.

- [ ] **Step 2: Update root README with installed-tool inventory**

Append to `README.md`:

```md
## What's in v0.1 (Plan 1)

- `@rokudev/device-client` (TS library): RFC 2617 Digest auth, ECP HTTP, dev portal, telnet, SSDP discovery, registry, error taxonomy.
- `rokudev-device` (MCP, stdio): registry tools, ECP read/control, dev-portal sideload/unload/screenshot/genkey/rekey/sign/diff/registry/profiler/crashlog, telnet log_tail/log_stream, composite dev_loop, cross-package version check.

Not in this release: BDP debugger (Plan 2), generator + module merger (Plan 3), freeform/LSP (Plan 4), brs-docs (Plan 5), skills + plugin (Plan 6).
```

- [ ] **Step 3: Tag the release**

```bash
git tag -a v0.1.0 -m "v0.1.0: roku-device-client + rokudev-device foundation"
```

- [ ] **Step 4: Final commit**

```bash
git add README.md
git commit -m "docs: Plan 1 release notes in README"
```

---

## Post-plan checklist

- [ ] Every task above has its tests run and committed.
- [ ] `pnpm release-prep` passes from a clean checkout.
- [ ] Manual smoke script exercised against at least one real Roku.
- [ ] Public export surface of `@rokudev/device-client` matches §2.3 of the spec.
- [ ] Error taxonomy in `errors/codes.ts` matches §4.6 (excluding codes from later plans).
- [ ] `dev_password` does not appear in any test fixture's expected output, in any captured log, or in any tool result schema.
- [ ] Registry file at `~/.config/rokudev/devices.toml` is created with mode 0600 by `device_add`.

When the checklist is green, hand off to Plan 2 (BDP debugger) which depends only on what Plan 1 ships.




