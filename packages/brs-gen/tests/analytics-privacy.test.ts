import { describe, it, expect } from 'vitest';
import { buildAutoProps } from './analytics-helpers.js';

const baseDi = {
  GetChannelClientId: () => 'ccid_xyz',
  GetRIDA: () => 'rida_abc',
  IsRIDADisabled: () => false,
  GetModel: () => '2910X',
  GetVersion: () => '15.2.4',
};

describe('buildAutoProps', () => {
  it('includes channel_client_id, session_id, channel_version, roku_model, roku_fw, ts_epoch_ms', () => {
    const out = buildAutoProps({
      di: baseDi,
      sessionId: 's_1',
      manifestVersion: '0.1.0',
      defaultProps: {},
      identity: {},
      nowMs: 1700000000000,
    });
    expect(out.channel_client_id).toBe('ccid_xyz');
    expect(out.session_id).toBe('s_1');
    expect(out.channel_version).toBe('0.1.0');
    expect(out.roku_model).toBe('2910X');
    expect(out.roku_fw).toBe('15.2.4');
    expect(out.ts_epoch_ms).toBe(1700000000000);
  });
  it('includes rida when IsRIDADisabled() returns false', () => {
    const out = buildAutoProps({ di: baseDi, sessionId: 's', manifestVersion: '0', defaultProps: {}, identity: {}, nowMs: 0 });
    expect(out.rida).toBe('rida_abc');
  });
  it('omits rida when IsRIDADisabled() returns true', () => {
    const di = { ...baseDi, IsRIDADisabled: () => true };
    const out = buildAutoProps({ di, sessionId: 's', manifestVersion: '0', defaultProps: {}, identity: {}, nowMs: 0 });
    expect('rida' in out).toBe(false);
  });
  it('merges default_props after auto-props', () => {
    const out = buildAutoProps({ di: baseDi, sessionId: 's', manifestVersion: '0', defaultProps: { environment: 'prod' }, identity: {}, nowMs: 0 });
    expect(out.environment).toBe('prod');
  });
  it('merges identity AFTER default_props (identity wins on key collision)', () => {
    const out = buildAutoProps({ di: baseDi, sessionId: 's', manifestVersion: '0', defaultProps: { environment: 'prod' }, identity: { environment: 'staging' }, nowMs: 0 });
    expect(out.environment).toBe('staging');
  });
});
