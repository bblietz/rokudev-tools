import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, writeFile, rm, cp } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from './loader.js';

function tmp() {
  return join(tmpdir(), `brs-gen-cat-${randomUUID()}`);
}

const T_TOML = `[template]
id = "t"
version = "0.1.0"
spec_compat = ">=1"
description = "d"
[template.exports]
init_hooks = []
scene_nodes = []
[template.manifest_defaults]
`;
const M_TOML = `[module]
id = "m"
version = "0.1.0"
spec_compat = ">=2"
description = "d"
[module.config_schema]
type = "object"
[module.files]
add = []
[module.wiring]
exports = []
requires = []
init_calls = []
[module.ordering]
before = []
after = []
[module.conflicts]
exclusive_with = []
`;

describe('loadCatalog', () => {
  let root: string;
  beforeEach(async () => {
    root = tmp();
    await mkdir(join(root, 'templates', 't'), { recursive: true });
    await mkdir(join(root, 'modules', 'm'), { recursive: true });
    await writeFile(join(root, 'templates', 't', 'template.toml'), T_TOML);
    await writeFile(join(root, 'modules', 'm', 'module.toml'), M_TOML);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('scans both dirs', async () => {
    const cat = await loadCatalog(root);
    expect(cat.templates.get('t')?.template.version).toBe('0.1.0');
    expect(cat.modules.get('m')?.module.version).toBe('0.1.0');
  });
  it('throws CATALOG_INVALID on malformed TOML', async () => {
    await writeFile(join(root, 'templates', 't', 'template.toml'), '= = =');
    await expect(loadCatalog(root)).rejects.toMatchObject({ code: 'CATALOG_INVALID' });
  });
  it('throws CATALOG_INVALID when id != dir name', async () => {
    await writeFile(
      join(root, 'templates', 't', 'template.toml'),
      T_TOML.replace('id = "t"', 'id = "other"'),
    );
    await expect(loadCatalog(root)).rejects.toMatchObject({ code: 'CATALOG_INVALID' });
  });
  it('emits ASYMMETRIC_CONFLICT warning on one-sided exclusive_with', async () => {
    const m2 = join(root, 'modules', 'm2');
    await mkdir(m2, { recursive: true });
    await writeFile(
      join(m2, 'module.toml'),
      M_TOML.replace('id = "m"', 'id = "m2"').replace(
        'exclusive_with = []',
        'exclusive_with = ["m"]',
      ),
    );
    const cat = await loadCatalog(root);
    expect(cat.warnings).toContainEqual(expect.objectContaining({ code: 'ASYMMETRIC_CONFLICT' }));
  });

  it('throws CATALOG_INVALID on module.files.add with traversal path', async () => {
    await writeFile(
      join(root, 'modules', 'm', 'module.toml'),
      M_TOML.replace('add = []', 'add = ["../escape.bs"]'),
    );
    await expect(loadCatalog(root)).rejects.toMatchObject({ code: 'CATALOG_INVALID' });
  });

  it('throws CATALOG_INVALID on template with case-only-different hook scopes', async () => {
    const colliding = `[template]
id = "t"
version = "0.1.0"
spec_compat = ">=1"
description = "d"
[[template.exports.init_hooks]]
scope = "Main"
phase = "before_scene_show"
file = "source/Main.bs"
signature = "(args as dynamic) as void"
[[template.exports.init_hooks]]
scope = "main"
phase = "before_scene_show"
file = "source/Main.bs"
signature = "(args as dynamic) as void"
[template.exports]
scene_nodes = []
[template.manifest_defaults]
`;
    await writeFile(join(root, 'templates', 't', 'template.toml'), colliding);
    await expect(loadCatalog(root)).rejects.toMatchObject({ code: 'CATALOG_INVALID' });
  });
});

describe('template_branding_defaults existence check', () => {
  const FIXTURE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../tests/fixtures');
  let tmps: string[] = [];
  afterEach(async () => {
    for (const t of tmps) await rm(t, { recursive: true, force: true });
    tmps = [];
  });

  it('loads a template whose branding_defaults.icon path exists', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'catalog-static-branding-'));
    tmps.push(tmp);
    await mkdir(join(tmp, 'templates'), { recursive: true });
    await mkdir(join(tmp, 'modules'), { recursive: true });
    await cp(
      join(FIXTURE_ROOT, 'template-with-static-branding-default'),
      join(tmp, 'templates', 'template-with-static-branding-default'),
      { recursive: true },
    );
    const cat = await loadCatalog(tmp);
    expect(cat.templates.has('template-with-static-branding-default')).toBe(true);
  });

  it('rejects a template whose branding_defaults.icon path is missing', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'catalog-missing-branding-'));
    tmps.push(tmp);
    await mkdir(join(tmp, 'templates', 'bad-branding'), { recursive: true });
    await mkdir(join(tmp, 'modules'), { recursive: true });
    await writeFile(
      join(tmp, 'templates', 'bad-branding', 'template.toml'),
      `[template]
id = "bad-branding"
version = "0.0.1"
spec_compat = ">=2"
description = "x"

[template.manifest_defaults]
title = "x"

[template.exports]
init_hooks = []
scene_nodes = []

[template.branding_defaults]
icon = "assets/missing.png"
primary_color = "#000000"
`,
    );
    await mkdir(join(tmp, 'templates', 'bad-branding', 'files'), { recursive: true });
    await writeFile(
      join(tmp, 'templates', 'bad-branding', 'files', 'manifest.ejs'),
      'placeholder\n',
    );
    await expect(loadCatalog(tmp)).rejects.toMatchObject({
      code: 'CATALOG_INVALID',
      message: expect.stringContaining('assets/missing.png'),
    });
  });
});
