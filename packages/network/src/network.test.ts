import { describe, expect, it } from 'vitest';
import { diffEntitlement, requiredCapabilities, type DesiredEntitlement } from './adapter.js';
import { FakeNetworkAdapter } from './fake.js';

const desired = (over: Partial<DesiredEntitlement> = {}): DesiredEntitlement => ({
  entitlementId: 'e1',
  state: 'ACTIVE',
  devices: ['aa:bb:cc:00:00:01'],
  policy: {
    downloadKbps: 5000,
    uploadKbps: 1000,
    maxConcurrentSessions: 2,
    expiresAt: '2026-11-01T10:00:00.000Z',
    maxSessionSeconds: 86400,
  },
  zones: [],
  ...over,
});

describe('diffEntitlement', () => {
  it('is empty when in sync and lists each difference otherwise', async () => {
    const g = new FakeNetworkAdapter('test');
    await g.applyEntitlement(desired());
    const o = await g.readEntitlement('e1');
    if ('unreachable' in o) throw new Error('unexpected');
    expect(diffEntitlement(desired(), o)).toEqual([]);
    expect(diffEntitlement(desired({ state: 'SUSPENDED' }), o)).toContain(
      'state ACTIVE ≠ SUSPENDED',
    );
    expect(diffEntitlement(desired({ devices: [] }), o)).toContain('device list differs');
    expect(
      diffEntitlement(desired({ policy: { ...desired().policy, downloadKbps: 1 } }), o),
    ).toContain('rate limit differs');
    expect(diffEntitlement(desired({ state: 'REVOKED' }), o)).toEqual([
      'present but should be revoked',
    ]);
  });
  it('reports missing entitlements', () => {
    expect(
      diffEntitlement(desired(), {
        entitlementId: 'e1',
        present: false,
        state: null,
        devices: [],
        policy: null,
      }),
    ).toEqual(['missing on gateway']);
  });
});

describe('capability honesty', () => {
  it('derives required capabilities from the desired state', () => {
    expect(requiredCapabilities(desired())).toContain('perDeviceRateLimit');
    expect(
      requiredCapabilities(
        desired({ policy: { ...desired().policy, downloadKbps: null, uploadKbps: null } }),
      ),
    ).not.toContain('perDeviceRateLimit');
    expect(requiredCapabilities(desired({ zones: ['vlan20'] }))).toContain('zones');
  });
  it('refuses to "apply" a rate limit it cannot enforce', async () => {
    const g = new FakeNetworkAdapter('test', { perDeviceRateLimit: 'UNSUPPORTED' });
    expect(await g.applyEntitlement(desired())).toMatchObject({
      ok: false,
      code: 'UNSUPPORTED',
      retryable: false,
    });
    expect(g.peek('e1')).toBeUndefined();
  });
});

describe('FakeNetworkAdapter', () => {
  it('is refused outside development/test', () => {
    expect(() => new FakeNetworkAdapter('production')).toThrow();
    expect(() => new FakeNetworkAdapter('staging')).toThrow();
  });
  it('simulates faults including changes that silently do not stick', async () => {
    const g = new FakeNetworkAdapter('test');
    g.injectFault('silently-ignore');
    expect(await g.applyEntitlement(desired())).toEqual({ ok: true });
    const o = await g.readEntitlement('e1');
    expect('present' in o && o.present).toBe(false);
    g.setDown(true);
    expect(await g.applyEntitlement(desired())).toMatchObject({
      ok: false,
      code: 'UNREACHABLE',
      retryable: true,
    });
    expect(await g.listActiveSessions()).toEqual({
      unreachable: true,
      detail: 'unreachable (simulated)',
    });
  });
  it('suspension and revocation end sessions', async () => {
    const g = new FakeNetworkAdapter('test');
    await g.applyEntitlement(desired());
    g.addSession('e1', 'aa:bb:cc:00:00:01');
    await g.applyEntitlement(desired({ state: 'SUSPENDED' }));
    expect(await g.listActiveSessions()).toEqual([]);
    g.addSession('e1', 'aa:bb:cc:00:00:01');
    await g.revokeEntitlement('e1');
    expect(await g.listActiveSessions()).toEqual([]);
  });
});

describe('client lookup (captive portal identity)', () => {
  it('confirms which device holds an IP; unknown IPs and outages are explicit', async () => {
    const g = new FakeNetworkAdapter('test');
    const c = g.joinClient('aa:bb:cc:00:00:09', '10.20.1.5');
    expect(await g.lookupClient(c.ip)).toEqual({ macAddress: 'aa:bb:cc:00:00:09' });
    expect(await g.lookupClient('10.20.9.9')).toBeNull();
    g.setDown(true);
    expect(await g.lookupClient(c.ip)).toEqual({
      unreachable: true,
      detail: 'unreachable (simulated)',
    });
  });
});
