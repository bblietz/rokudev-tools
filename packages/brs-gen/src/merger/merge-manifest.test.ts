import { describe, it, expect } from 'vitest';
import { mergeManifest } from './merge-manifest.js';

describe('mergeManifest', () => {
  it('template defaults survive when no module contributes', () => {
    const r = mergeManifest({ title: 'T', ui_resolutions: 'fhd' }, []);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('narrowing');
    expect(Object.fromEntries(r.manifest)).toEqual({ title: 'T', ui_resolutions: 'fhd' });
  });

  it('set-if-unset: module fills unset splash icons', () => {
    const r = mergeManifest({ title: 'T' }, [{ id: 'm', manifest: { splash_screen_hd: 'pkg:/x.png' } }]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('narrowing');
    expect(r.manifest.get('splash_screen_hd')).toBe('pkg:/x.png');
  });

  it('set-if-unset: two modules setting same key raises MANIFEST_KEY_CONFLICT', () => {
    const r = mergeManifest({}, [
      { id: 'a', manifest: { splash_screen_hd: 'pkg:/a.png' } },
      { id: 'b', manifest: { splash_screen_hd: 'pkg:/b.png' } },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('narrowing');
    expect(r.failure.code).toBe('MANIFEST_KEY_CONFLICT');
  });

  it('append-csv: modules contributions joined and sorted-deduped', () => {
    const r = mergeManifest({ bs_const: 'BASE=1' }, [
      { id: 'a', manifest: { bs_const: 'B=1,A=1' } },
      { id: 'b', manifest: { bs_const: 'C=1,B=1' } },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('narrowing');
    expect(r.manifest.get('bs_const')).toBe('A=1,B=1,BASE=1,C=1');
  });

  it('set: two modules with different values raise MANIFEST_KEY_CONFLICT', () => {
    const r = mergeManifest({}, [
      { id: 'a', manifest: { title: 'One' } },
      { id: 'b', manifest: { title: 'Two' } },
    ]);
    expect(r.ok).toBe(false);
  });

  it('set: two modules with equal values converge silently', () => {
    const r = mergeManifest({}, [
      { id: 'a', manifest: { title: 'Same' } },
      { id: 'b', manifest: { title: 'Same' } },
    ]);
    expect(r.ok).toBe(true);
  });

  it('UNKNOWN_MANIFEST_KEY when a module uses a key not in the table', () => {
    const r = mergeManifest({}, [{ id: 'a', manifest: { made_up: 'x' } }]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('narrowing');
    expect(r.failure.code).toBe('UNKNOWN_MANIFEST_KEY');
  });

  it('rejects modules that try to set template-only keys', () => {
    const r = mergeManifest({}, [{ id: 'a', manifest: { major_version: '2' } }]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('narrowing');
    expect(r.failure.code).toBe('MANIFEST_KEY_CONFLICT');
  });

  it('append-csv: empty tokens in malformed input are dropped', () => {
    const r = mergeManifest({}, [
      { id: 'a', manifest: { bs_const: 'A=1,,B=1' } },
      { id: 'b', manifest: { bs_const: ',C=1,' } },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('narrowing');
    expect(r.manifest.get('bs_const')).toBe('A=1,B=1,C=1');
  });
});
