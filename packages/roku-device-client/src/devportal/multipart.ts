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
      chunks.push(
        Buffer.from(`Content-Disposition: form-data; name="${p.name}"\r\n\r\n${p.value}\r\n`),
      );
    } else {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${p.name}"; filename="${p.filename}"\r\n` +
            `Content-Type: ${p.contentType}\r\n\r\n`,
        ),
      );
      chunks.push(p.body);
      chunks.push(Buffer.from('\r\n'));
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}
