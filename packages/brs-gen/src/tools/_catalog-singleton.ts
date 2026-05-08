import type { Catalog } from '../catalog/loader.js';

let current: Catalog | undefined;

export function setCatalog(c: Catalog): void { current = c; }
export function getCatalog(): Catalog {
  if (!current) throw new Error('catalog not initialised; call setCatalog() during bootstrap');
  return current;
}

// test-only seam
export function setCatalogForTests(c: Catalog): void { current = c; }
export function _resetCatalog(): void { current = undefined; }
