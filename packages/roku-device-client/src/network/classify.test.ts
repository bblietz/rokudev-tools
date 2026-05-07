import { describe, it, expect } from 'vitest';
import { classifyNetwork, isReachable } from './classify.js';

describe('classifyNetwork', () => {
  const homeNet = { gateway_mac: 'aa:bb:cc:00:00:01', gateway_subnet_v4: '192.168.1.0/24' };
  const corpNet = {
    gateway_mac: 'aa:bb:cc:00:00:02',
    dns_search_suffix: 'corp.example.com',
    reachable_from: ['corp', 'home_via_vpn'],
  };

  it('classifies home when MAC + subnet match', () => {
    const t = classifyNetwork(
      {
        gateway_mac: 'aa:bb:cc:00:00:01',
        gateway_subnet_v4: '192.168.1.0/24',
        vpn_iface_present: false,
      },
      { home: homeNet, corp: corpNet },
    );
    expect(t).toBe('home');
  });

  it('classifies corp via DNS suffix', () => {
    const t = classifyNetwork(
      {
        gateway_mac: 'aa:bb:cc:00:00:02',
        dns_search_suffix: 'corp.example.com',
        vpn_iface_present: false,
      },
      { home: homeNet, corp: corpNet },
    );
    expect(t).toBe('corp');
  });

  it('classifies home_via_vpn when corp matches and VPN iface up', () => {
    const t = classifyNetwork(
      {
        gateway_mac: 'aa:bb:cc:00:00:02',
        dns_search_suffix: 'corp.example.com',
        vpn_iface_present: true,
      },
      { home: homeNet, corp: corpNet },
    );
    expect(t).toBe('home_via_vpn');
  });

  it('returns unknown when MAC matches but neither subnet nor DNS does', () => {
    const t = classifyNetwork(
      {
        gateway_mac: 'aa:bb:cc:00:00:01',
        gateway_subnet_v4: '10.0.0.0/24',
        vpn_iface_present: false,
      },
      { home: homeNet, corp: corpNet },
    );
    expect(t).toBe('unknown');
  });

  it('returns unknown when no MAC available', () => {
    const t = classifyNetwork({ vpn_iface_present: false }, { home: homeNet });
    expect(t).toBe('unknown');
  });

  it('matches MAC case-insensitively', () => {
    const upperHomeNet = { gateway_mac: 'AA:BB:CC:00:00:01', gateway_subnet_v4: '192.168.1.0/24' };
    const t = classifyNetwork(
      {
        gateway_mac: 'aa:bb:cc:00:00:01',
        gateway_subnet_v4: '192.168.1.0/24',
        vpn_iface_present: false,
      },
      { home: upperHomeNet },
    );
    expect(t).toBe('home');
  });
});

describe('isReachable', () => {
  const corpNet = { gateway_mac: 'x', reachable_from: ['corp', 'home_via_vpn'] };
  const homeNet = { gateway_mac: 'y' };

  it('permissive when current is unknown', () => {
    expect(isReachable('unknown', 'home', { home: homeNet, corp: corpNet })).toBe(true);
  });

  it('same network always reachable', () => {
    expect(isReachable('corp', 'corp', { home: homeNet, corp: corpNet })).toBe(true);
  });

  it('home cannot reach corp via reachable_from', () => {
    expect(isReachable('home', 'corp', { home: homeNet, corp: corpNet })).toBe(false);
  });

  it('home_via_vpn can reach corp', () => {
    expect(isReachable('home_via_vpn', 'corp', { home: homeNet, corp: corpNet })).toBe(true);
  });

  it('corp cannot reach home (asymmetric)', () => {
    expect(isReachable('corp', 'home', { home: homeNet, corp: corpNet })).toBe(false);
  });

  it('blocks reaching an unknown-tagged target from a known network (untagged device policy)', () => {
    // Documented current policy: when the target's network is not in the registry
    // (or it is 'unknown'), reach is denied unless current is 'unknown'. Callers
    // can override with force:true at the device-resolution layer.
    expect(isReachable('corp', 'unknown', { home: homeNet, corp: corpNet })).toBe(false);
  });

  it('home_via_vpn cannot reach home in default registry config (requires explicit reachable_from on home)', () => {
    // Documented current policy: home_via_vpn means "physically at home with VPN
    // to corp". Reaching the home network would intuitively be allowed, but the
    // implementation requires the user to set reachable_from explicitly on the
    // home network entry. This test pins current behavior; revisit if the spec
    // changes the implicit reachability rule.
    expect(isReachable('home_via_vpn', 'home', { home: homeNet, corp: corpNet })).toBe(false);
  });
});
