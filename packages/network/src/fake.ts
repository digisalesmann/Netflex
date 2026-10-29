import { assertSimulatorAllowed, type NetflexEnvironment } from '@netflex/config';
import {
  CAPABILITIES,
  requiredCapabilities,
  unsupported,
  type CapabilityReport,
  type DesiredEntitlement,
  type GatewayHealth,
  type NetworkAdapter,
  type ObservedEntitlement,
  type ObservedSession,
  type OperationResult,
} from './adapter.js';

type Fault = 'unreachable' | 'reject' | 'silently-ignore' | 'auth';

/**
 * TEST DOUBLE — simulates a gateway in memory. It enforces nothing on any real
 * network. Fault injection covers outages, rejections, auth failures and
 * "accepted but didn't stick" (to prove read-back verification works).
 */
export class FakeNetworkAdapter implements NetworkAdapter {
  readonly vendor = 'FAKE';
  private readonly state = new Map<string, ObservedEntitlement>();
  private readonly sessions = new Map<string, ObservedSession>();
  private readonly faults: Fault[] = [];
  /** Captive-network clients currently holding an IP (simulated DHCP/host table). */
  private readonly hosts = new Map<string, string>();
  private down = false;
  readonly calls: { op: string; entitlementId: string }[] = [];
  capabilities: CapabilityReport;

  constructor(env: NetflexEnvironment, capabilities: Partial<CapabilityReport> = {}) {
    assertSimulatorAllowed(env, 'FakeNetworkAdapter');
    this.capabilities = {
      ...(Object.fromEntries(CAPABILITIES.map((c) => [c, 'SUPPORTED'])) as CapabilityReport),
      ...capabilities,
    };
  }

  /** Next mutating call(s) misbehave this way. */
  injectFault(f: Fault, times = 1): void {
    for (let i = 0; i < times; i++) this.faults.push(f);
  }
  setDown(down: boolean): void {
    this.down = down;
  }
  /** Simulate a client logging in through the captive portal. */
  addSession(
    entitlementId: string | null,
    macAddress: string,
    id = `s-${this.sessions.size + 1}`,
  ): ObservedSession {
    const s = {
      gatewaySessionId: id,
      entitlementId,
      macAddress,
      ipAddress: `10.20.0.${this.sessions.size + 2}`,
      startedAt: new Date().toISOString(),
      bytesIn: 0,
      bytesOut: 0,
    };
    this.sessions.set(id, s);
    return s;
  }
  /** Simulate a device joining the Wi-Fi and receiving an IP address. */
  joinClient(
    macAddress: string,
    ip = `10.20.${Math.floor(Math.random() * 200) + 1}.${Math.floor(Math.random() * 250) + 2}`,
  ): { ip: string; macAddress: string } {
    this.hosts.set(ip, macAddress);
    return { ip, macAddress };
  }

  lookupClient(
    clientIp: string,
  ): Promise<{ macAddress: string } | null | { unreachable: true; detail: string }> {
    if (this.down) return Promise.resolve({ unreachable: true, detail: 'unreachable (simulated)' });
    const mac = this.hosts.get(clientIp);
    return Promise.resolve(mac ? { macAddress: mac } : null);
  }

  /** Simulate someone deleting config on the router by hand (drift). */
  tamper(entitlementId: string): void {
    this.state.delete(entitlementId);
  }
  peek(entitlementId: string): ObservedEntitlement | undefined {
    return this.state.get(entitlementId);
  }

  private fault(): OperationResult | 'ignore' | null {
    if (this.down)
      return {
        ok: false,
        code: 'UNREACHABLE',
        retryable: true,
        detail: 'gateway unreachable (simulated)',
      };
    const f = this.faults.shift();
    if (f === 'unreachable')
      return {
        ok: false,
        code: 'UNREACHABLE',
        retryable: true,
        detail: 'gateway unreachable (simulated)',
      };
    if (f === 'reject')
      return {
        ok: false,
        code: 'REJECTED',
        retryable: true,
        detail: 'gateway rejected change (simulated)',
      };
    if (f === 'auth')
      return {
        ok: false,
        code: 'AUTH_FAILED',
        retryable: false,
        detail: 'credentials rejected (simulated)',
      };
    if (f === 'silently-ignore') return 'ignore';
    return null;
  }

  getCapabilities(): CapabilityReport {
    return { ...this.capabilities };
  }

  healthCheck(): Promise<GatewayHealth> {
    return Promise.resolve(
      this.down
        ? { reachable: false, latencyMs: null, firmware: null, detail: 'unreachable (simulated)' }
        : { reachable: true, latencyMs: 3, firmware: 'fake-1.0', detail: 'ok (simulated)' },
    );
  }

  applyEntitlement(d: DesiredEntitlement): Promise<OperationResult> {
    this.calls.push({ op: 'apply', entitlementId: d.entitlementId });
    const missing = requiredCapabilities(d).filter((c) => this.capabilities[c] !== 'SUPPORTED');
    if (missing.length)
      return Promise.resolve(unsupported(`gateway cannot enforce: ${missing.join(', ')}`));
    const f = this.fault();
    if (f === 'ignore') return Promise.resolve({ ok: true });
    if (f) return Promise.resolve(f);
    if (d.state === 'REVOKED') {
      this.state.delete(d.entitlementId);
      return Promise.resolve({ ok: true });
    }
    this.state.set(d.entitlementId, {
      entitlementId: d.entitlementId,
      present: true,
      state: d.state,
      devices: [...d.devices],
      policy: {
        downloadKbps: d.policy.downloadKbps,
        uploadKbps: d.policy.uploadKbps,
        maxConcurrentSessions: d.policy.maxConcurrentSessions,
        expiresAt: d.policy.expiresAt,
      },
    });
    if (d.state === 'SUSPENDED')
      for (const [k, s] of this.sessions)
        if (s.entitlementId === d.entitlementId) this.sessions.delete(k);
    return Promise.resolve({ ok: true });
  }

  revokeEntitlement(entitlementId: string): Promise<OperationResult> {
    this.calls.push({ op: 'revoke', entitlementId });
    const f = this.fault();
    if (f === 'ignore') return Promise.resolve({ ok: true });
    if (f) return Promise.resolve(f);
    this.state.delete(entitlementId);
    for (const [k, s] of this.sessions)
      if (s.entitlementId === entitlementId) this.sessions.delete(k);
    return Promise.resolve({ ok: true });
  }

  disconnectDevice(entitlementId: string, macAddress: string): Promise<OperationResult> {
    this.calls.push({ op: 'disconnect', entitlementId });
    if (this.capabilities.sessionDisconnect !== 'SUPPORTED')
      return Promise.resolve(unsupported('gateway cannot disconnect sessions'));
    const f = this.fault();
    if (f === 'ignore') return Promise.resolve({ ok: true });
    if (f) return Promise.resolve(f);
    for (const [k, s] of this.sessions)
      if (s.entitlementId === entitlementId && s.macAddress === macAddress) this.sessions.delete(k);
    return Promise.resolve({ ok: true });
  }

  readEntitlement(
    entitlementId: string,
  ): Promise<ObservedEntitlement | { unreachable: true; detail: string }> {
    if (this.down) return Promise.resolve({ unreachable: true, detail: 'unreachable (simulated)' });
    const s = this.state.get(entitlementId);
    return Promise.resolve(
      s
        ? structuredClone(s)
        : { entitlementId, present: false, state: null, devices: [], policy: null },
    );
  }

  listActiveSessions(): Promise<ObservedSession[] | { unreachable: true; detail: string }> {
    if (this.down) return Promise.resolve({ unreachable: true, detail: 'unreachable (simulated)' });
    return Promise.resolve([...this.sessions.values()].map((s) => ({ ...s })));
  }
}
