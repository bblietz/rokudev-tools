import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { loadCatalog } from './loader.js';

function tmp() { return join(tmpdir(), `brs-gen-cat-${randomUUID()}`); }

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
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

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
    await writeFile(join(root, 'templates', 't', 'template.toml'),
                    T_TOML.replace('id = "t"', 'id = "other"'));
    await expect(loadCatalog(root)).rejects.toMatchObject({ code: 'CATALOG_INVALID' });
  });
  it('emits ASYMMETRIC_CONFLICT warning on one-sided exclusive_with', async () => {
    const m2 = join(root, 'modules', 'm2');
    await mkdir(m2, { recursive: true });
    await writeFile(join(m2, 'module.toml'),
                    M_TOML.replace('id = "m"', 'id = "m2"')
                          .replace('exclusive_with = []', 'exclusive_with = ["m"]'));
    const cat = await loadCatalog(root);
    expect(cat.warnings).toContainEqual(expect.objectContaining({ code: 'ASYMMETRIC_CONFLICT' }));
  });
});
