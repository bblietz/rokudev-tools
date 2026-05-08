import ejs from 'ejs';
import { makeHelpers } from './helpers.js';
import { normalizeText } from '../util/text-normalize.js';

// Allowlist of extensions treated as text (EJS-rendered). Anything not in
// this set is copied verbatim as bytes. Plan 4's real templates may add
// more entries (.yml, .yaml, .toml, .md, .env, .js, .ts). Keep this list
// in sync with what templates actually ship; unknown text files silently
// pass through as binary, which embeds `<%= ... %>` markers in the final
// artifact. Catalog authors see this in snapshot tests (T29).
const TEXT_EXTS = new Set([
  '.bs', '.brs', '.xml', '.ejs', '.txt', '.json',
  // Likely-needed by Plan 4 templates (add as soon as any template uses them):
  '.md', '.yml', '.yaml', '.toml', '.env', '.js', '.ts',
]);

function ext(path: string): string {
  const m = path.match(/\.[^./\\]+$/);
  return m ? m[0] : '';
}

function isTextFile(path: string): boolean {
  return TEXT_EXTS.has(ext(path));
}

// Strips one trailing .ejs suffix from path ('manifest.ejs' -> 'manifest').
// Catalog-load time (T4) rejects any file whose name contains '.ejs.' in the
// middle, so `Main.ejs.xml` is caught upstream and never reaches here. This
// function handles only the trailing-suffix case.
function stripEjsSuffix(path: string): string {
  return path.endsWith('.ejs') ? path.slice(0, -'.ejs'.length) : path;
}

type Meta = { brs_gen_version: string; template_version: string };

export async function renderTemplateFiles(
  files: ReadonlyArray<{ path: string; bytes: Buffer }>,
  spec: unknown,
  meta: Meta,
): Promise<Array<{ path: string; content: string | Buffer }>> {
  const helpers = makeHelpers();
  const out: Array<{ path: string; content: string | Buffer }> = [];
  for (const f of files) {
    if (!isTextFile(f.path)) {
      out.push({ path: f.path, content: f.bytes });
      continue;
    }
    const src = normalizeText(f.bytes.toString('utf8'));
    const rendered = await ejs.render(src, { spec, helpers, meta }, { async: true, escape: (v) => String(v) });
    // ejs escape override: we disabled HTML escape by setting escape to identity;
    // BrightScript hex literals like &hFF00FFFF would otherwise be mangled.
    out.push({ path: stripEjsSuffix(f.path), content: rendered });
  }
  return out;
}
