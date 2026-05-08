import { parse } from 'smol-toml';

export function parseToml(src: string): Record<string, unknown> {
  return parse(src) as Record<string, unknown>;
}
