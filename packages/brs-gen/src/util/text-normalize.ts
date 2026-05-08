export function normalizeText(s: string): string {
  let out = s;
  if (out.charCodeAt(0) === 0xfeff) out = out.slice(1);    // strip UTF-8 BOM
  out = out.replace(/\r\n/g, '\n').replace(/\r/g, '\n');   // CRLF / CR -> LF
  return out;
}
