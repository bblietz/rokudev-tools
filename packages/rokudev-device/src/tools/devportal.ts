import { registerToolsModule, type ToolDef } from './_register.js';
import { DevPortal, DevPortalInspect, diffInstalled, fail } from '@rokudev/device-client';
import { resolveTarget } from '../util/resolve-target.js';
import { checkReachable } from '../util/network-guard.js';

function tool(t: ToolDef): ToolDef {
  return t;
}

const baseProps = {
  device: { type: 'string' },
  host: { type: 'string' },
  dev_password: { type: 'string' },
  force: { type: 'boolean' },
};

/** Resolve target, guard network reachability, and assert dev_password is present. */
async function ensurePassword(
  args: Record<string, unknown>,
): Promise<{ device?: string; host: string; dev_password: string }> {
  const t = await resolveTarget(args as Record<string, string>);
  await checkReachable(t.device, args['force'] === true);
  if (!t.dev_password) throw fail('DEVICE_NO_PASSWORD', 'no dev_password resolved');
  return t as { device?: string; host: string; dev_password: string };
}

// ---------------------------------------------------------------------------
// Named handlers for screenshot and pack_signed (Gotchas 6 and 7).
// ---------------------------------------------------------------------------

async function screenshotHandler(a: Record<string, unknown>): Promise<unknown> {
  const t = await ensurePassword(a);
  const dp = new DevPortalInspect(t.host, t.dev_password);
  // screenshot() is parameterless — format input is accepted in the schema for forward
  // compatibility (spec §4.3) but ignored here. The mime field in the response is authoritative.
  const shot = await dp.screenshot();
  const ret = (a['return'] as 'inline' | 'ref' | undefined) ?? 'inline';
  if (ret === 'inline') {
    return { ok: true, host: t.host, ...shot };
  }

  // ref mode: write to ~/.cache/rokudev/screenshots/<sha>.<ext> with mode 0o600.
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { homedir } = await import('node:os');
  const { createHash } = await import('node:crypto');
  const cacheDir = join(homedir(), '.cache', 'rokudev', 'screenshots');
  await mkdir(cacheDir, { recursive: true, mode: 0o700 });
  const sha = createHash('sha256').update(shot.base64, 'base64').digest('hex');
  const ext = shot.mime === 'image/png' ? 'png' : 'jpg';
  const path = join(cacheDir, `${sha}.${ext}`);
  await writeFile(path, Buffer.from(shot.base64, 'base64'), { mode: 0o600 });
  return {
    ok: true,
    host: t.host,
    mime: shot.mime,
    bytes: shot.bytes,
    path,
    duration_ms: shot.duration_ms,
  };
}

async function packSignedHandler(a: Record<string, unknown>): Promise<unknown> {
  const t = await ensurePassword(a);
  // signing_password is per-call only; resolveTarget does NOT consult the registry for it.
  const signingPassword = a['signing_password'] as string;
  const outputPkg = a['output_pkg'] as string;
  const dp = new DevPortalInspect(t.host, t.dev_password);
  const result = await dp.packSigned(signingPassword);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(outputPkg, result.pkg_bytes);
  // Do NOT return pkg_bytes — it is large, breaks JSON serialization, and leaks the signed package.
  return {
    ok: true,
    host: t.host,
    output_pkg: outputPkg,
    bytes: result.pkg_bytes.length,
    duration_ms: result.duration_ms,
  };
}

// ---------------------------------------------------------------------------
// Tool registrations
// ---------------------------------------------------------------------------

registerToolsModule((tools) => {
  tools.set(
    'sideload',
    tool({
      name: 'sideload',
      description:
        'Sideload a Roku channel zip via /plugin_install (Digest auth). ' +
        'Pass debug=true to also attach remotedebug + remotedebug_connect_early ' +
        'formdata so BDP listener on TCP 8081 opens at install time -- required ' +
        'on fw 15.2.4 build 3442 for debug_attach to win the listener race.',
      inputSchema: {
        type: 'object',
        properties: {
          ...baseProps,
          zip_path: { type: 'string' },
          debug: { type: 'boolean' },
        },
        required: ['zip_path'],
        additionalProperties: false,
      },
      handler: async (a) => {
        const t = await ensurePassword(a);
        const { ok: _ok, ...r } = await new DevPortal(t.host, t.dev_password).sideload(
          a['zip_path'] as string,
          { debug: a['debug'] === true },
        );
        return { ok: true, host: t.host, ...r };
      },
    }),
  );

  tools.set(
    'unload',
    tool({
      name: 'unload',
      description: 'Remove the currently-installed dev channel via /plugin_install Delete.',
      inputSchema: {
        type: 'object',
        properties: { ...baseProps },
        additionalProperties: false,
      },
      handler: async (a) => {
        const t = await ensurePassword(a);
        const { ok: _ok, ...r } = await new DevPortal(t.host, t.dev_password).unload();
        return { ok: true, host: t.host, ...r };
      },
    }),
  );

  tools.set(
    'screenshot',
    tool({
      name: 'screenshot',
      description: 'Capture a screenshot from the Roku via /plugin_inspect.',
      inputSchema: {
        type: 'object',
        properties: {
          ...baseProps,
          // format is accepted but ignored — screenshot() is parameterless (Gotcha 1).
          // The mime field in the response is authoritative for the actual format.
          format: { type: 'string', enum: ['jpg', 'png'] },
          return: { type: 'string', enum: ['inline', 'ref'], default: 'inline' },
        },
        additionalProperties: false,
      },
      handler: screenshotHandler,
    }),
  );

  tools.set(
    'genkey',
    tool({
      name: 'genkey',
      description: 'Generate a new dev signing key on the Roku.',
      inputSchema: {
        type: 'object',
        properties: { ...baseProps },
        additionalProperties: false,
      },
      handler: async (a) => {
        const t = await ensurePassword(a);
        const { ok: _ok, ...r } = await new DevPortalInspect(t.host, t.dev_password).genkey();
        return { ok: true, host: t.host, ...r };
      },
    }),
  );

  tools.set(
    'rekey',
    tool({
      name: 'rekey',
      description: 'Rekey the Roku using a previously-signed package.',
      inputSchema: {
        type: 'object',
        properties: {
          ...baseProps,
          signed_pkg_path: { type: 'string' },
          password: { type: 'string' },
        },
        required: ['signed_pkg_path', 'password'],
        additionalProperties: false,
      },
      handler: async (a) => {
        const t = await ensurePassword(a);
        const { ok: _ok, ...r } = await new DevPortalInspect(t.host, t.dev_password).rekey(
          a['signed_pkg_path'] as string,
          a['password'] as string,
        );
        return { ok: true, host: t.host, ...r };
      },
    }),
  );

  tools.set(
    'pack_signed',
    tool({
      name: 'pack_signed',
      description: 'Build a signed Roku package: ask the device to sign and download the .pkg.',
      inputSchema: {
        type: 'object',
        properties: {
          ...baseProps,
          project_dir: { type: 'string' },
          signing_password: { type: 'string' },
          output_pkg: { type: 'string' },
        },
        required: ['project_dir', 'signing_password', 'output_pkg'],
        additionalProperties: false,
      },
      handler: packSignedHandler,
    }),
  );

  tools.set(
    'diff_installed',
    tool({
      name: 'diff_installed',
      description:
        'Compare a local project dir against the dev package currently installed on the Roku.',
      inputSchema: {
        type: 'object',
        properties: { ...baseProps, project_dir: { type: 'string' } },
        required: ['project_dir'],
        additionalProperties: false,
      },
      handler: async (a) => {
        const t = await ensurePassword(a);
        const { ok: _ok, ...r } = await diffInstalled(
          t.host,
          t.dev_password,
          a['project_dir'] as string,
        );
        return { ok: true, host: t.host, ...r };
      },
    }),
  );

  tools.set(
    'query_registry',
    tool({
      name: 'query_registry',
      description: 'Read the on-device BrightScript registry for a dev_id.',
      inputSchema: {
        type: 'object',
        properties: { ...baseProps, dev_id: { type: 'string' } },
        required: ['dev_id'],
        additionalProperties: false,
      },
      handler: async (a) => {
        const t = await ensurePassword(a);
        const { ok: _ok, ...r } = await new DevPortalInspect(t.host, t.dev_password).queryRegistry(
          a['dev_id'] as string,
        );
        return { ok: true, host: t.host, ...r };
      },
    }),
  );

  tools.set(
    'profiler_snapshot',
    tool({
      name: 'profiler_snapshot',
      description: 'Capture a profiler snapshot from /plugin_inspect with mysubmit=Inspect.',
      inputSchema: {
        type: 'object',
        properties: { ...baseProps },
        additionalProperties: false,
      },
      handler: async (a) => {
        const t = await ensurePassword(a);
        const { ok: _ok, ...r } = await new DevPortalInspect(
          t.host,
          t.dev_password,
        ).profilerSnapshot();
        return { ok: true, host: t.host, ...r };
      },
    }),
  );

  tools.set(
    'crashlog_pull',
    tool({
      name: 'crashlog_pull',
      description: 'Pull /plugin_factory_log from the Roku.',
      inputSchema: {
        type: 'object',
        properties: { ...baseProps },
        additionalProperties: false,
      },
      handler: async (a) => {
        const t = await ensurePassword(a);
        const { ok: _ok, ...r } = await new DevPortalInspect(t.host, t.dev_password).crashlogPull();
        return { ok: true, host: t.host, ...r };
      },
    }),
  );
});
