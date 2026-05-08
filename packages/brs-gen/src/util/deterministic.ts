import { fail } from '@rokudev/device-client';

export function escapeBsString(s: string): string {
  // BrightScript string literals cannot contain unescaped newlines, NULs, or
  // other non-printable control characters; there is no backslash-escape
  // syntax inside a "..." literal (only doubled `""` to represent `"`).
  // Reject any such input with APP_SPEC_INVALID so the failure surfaces at
  // generate_app time rather than producing unparseable BrightScript source.
  //
  // If a future caller needs to embed a newline, the callsite must build it
  // via chr(10) concatenation: `"prefix" + chr(10) + "suffix"`. Not handled
  // automatically here because Plan 3's stub module doesn't need it.
  if (/[\x00-\x1F\x7F]/.test(s)) {
    throw fail('APP_SPEC_INVALID',
      'string value contains a control character (e.g. newline or NUL) which cannot be encoded in a BrightScript string literal',
      { value: s });
  }
  return `"${s.replace(/"/g, '""')}"`;
}

export function stringifyAsBsValue(v: unknown): string {
  if (v === null || v === undefined) return 'invalid';
  if (typeof v === 'string') return escapeBsString(v);
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'invalid';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return `[${v.map(stringifyAsBsValue).join(', ')}]`;
  if (typeof v === 'object') {
    const keys = Object.keys(v as Record<string, unknown>).sort();
    const body = keys.map((k) => `${k}: ${stringifyAsBsValue((v as Record<string, unknown>)[k])}`).join(', ');
    return `{ ${body} }`;
  }
  return 'invalid';
}

export function sortByPath<T extends { path: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
