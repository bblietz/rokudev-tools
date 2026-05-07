import { describe, it, expect } from 'vitest';
import { classifyNetwork, isReachable } from './classify.js';

describe('classifyNetwork', () => {
  const homeNet = { gateway_mac: 'aa:bb:cc:00:00:01', gateway_subnet_v4: '192.168.1.0/24' };
  const corpNet = { gateway_mac: 'aa:bb:cc:00:00:02', dns_search_suffix: 'corp.example.com',
                    reachable_from: ['corp', 'home_via_vpn'] };

  it('classifies home when MAC + subnet match', () => {
    const t = classifyNetwork(
      { gateway_mac: 'aa:bb:cc:00:00:01', gateway_subnet_v4: '192.168.1.0/24', vpn_iface_present: false },
      { home: homeNet, corp: corpNet },
    );
    expect(t).toBe('home');
  });

  it('classifies corp via DNS suffix', () => {
    const t = classifyNetwork(
      { gateway_mac: 'aa:bb:cc:00:00:02', dns_search_suffix: 'corp.example.com', vpn_iface_present: false },
      { home: homeNet, corp: corpNet },
    );
    expect(t).toBe('corp');
  });

  it('classifies home_via_vpn when corp matches and VPN iface up', () => {
    const t = classifyNetwork(
      { gateway_mac: 'aa:bb:cc:00:00:02', dns_search_suffix: 'corp.example.com', vpn_iface_present: true },
      { home: homeNet, corp: corpNet },
    );
    expect(t).toBe('home_via_vpn');
  });

  it('returns unknown when MAC matches but neither subnet nor DNS does', () => {
    const t = classifyNetwork(
      { gateway_mac: 'aa:bb:cc:00:00:01', gateway_subnet_v4: '10.0.0.0/24', vpn_iface_present: false },
      { home: homeNet, corp: corpNet },
    );
    expect(t).toBe('unknown');
  });

  it('returns unknown when no MAC available', () => {
    const t = classifyNetwork({ vpn_iface_present: false }, { home: homeNet });
    expect(t).toBe('unknown');
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
});
