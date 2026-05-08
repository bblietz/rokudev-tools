import { describe, it, expect } from 'vitest';
import { renderTemplateFiles } from './ejs.js';

describe('renderTemplateFiles', () => {
  const spec = {
    spec_version: 2 as const, template: 't', modules: [],
    app: { name: 'Hi', major_version: 1, minor_version: 0, build_version: 0 },
  };
  const meta = { brs_gen_version: '0.3.0', template_version: '0.1.0' };

  it('interpolates spec.app.name into a .bs file', async () => {
    const files = [
      { path: 'source/Main.bs', bytes: Buffer.from('print "<%= spec.app.name %>"\n') },
    ];
    const out = await renderTemplateFiles(files, spec as any, meta);
    expect(out[0].path).toBe('source/Main.bs');
    expect(out[0].content).toBe('print "Hi"\n');
  });

  it('normalises CRLF on text files', async () => {
    const files = [{ path: 'x.bs', bytes: Buffer.from('a\r\nb\r\n') }];
    const out = await renderTemplateFiles(files, spec as any, meta);
    expect(out[0].content).toBe('a\nb\n');
  });

  it('passes binary files through unchanged', async () => {
    const bin = Buffer.from([0xff, 0xfe, 0x00, 0x01]);
    const files = [{ path: 'images/icon.png', bytes: bin }];
    const out = await renderTemplateFiles(files, spec as any, meta);
    expect(Buffer.isBuffer(out[0].content)).toBe(true);
    expect(out[0].content as Buffer).toEqual(bin);
  });

  it('does NOT auto-escape HTML (BrightScript hex literals survive)', async () => {
    const files = [{ path: 'comp.xml', bytes: Buffer.from('<color><%- "&hFF00FFFF" %></color>') }];
    const out = await renderTemplateFiles(files, spec as any, meta);
    expect(out[0].content).toBe('<color>&hFF00FFFF</color>');
  });

  it('.ejs suffix is stripped from the output path', async () => {
    const files = [{ path: 'manifest.ejs', bytes: Buffer.from('title=<%= spec.app.name %>\n') }];
    const out = await renderTemplateFiles(files, spec as any, meta);
    expect(out[0].path).toBe('manifest');
    expect(out[0].content).toBe('title=Hi\n');
  });
});
