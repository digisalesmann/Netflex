/**
 * Hardware-neutral gateway contract (spec §11.1). Business logic only ever
 * talks to this interface. Rules every adapter must follow:
 *
 * - Declare capabilities honestly. An operation needing an unsupported
 *   capability returns { ok: false, code: 'UNSUPPORTED' } — it must never
 *   pretend to enforce a policy the gateway cannot enforce.
 * - Apply the FULL desired state (idempotent, last-writer-wins), never deltas,
 *   so retries and out-of-order operations converge.
 * - Never return raw router output, passwords or management addresses: only
 *   the structured results below with safe, short details.
 */

export const CAPABILITIES = [
  'captivePortal',
  'voucherAuth',
  'externalPortal',
  'apiAutomation',
  'radius',
  'perDeviceRateLimit',
  'groupRateLimit',
  'concurrentSessionLimit',
  'sessionDisconnect',
  'usageCounters',
  'scheduledExpiry',
  'zones',
  'healthStatus',
  'secureRemoteManagement',
] as const;
export type Capability = (typeof CAPABILITIES)[number];
export type CapabilitySupport = 'SUPPORTED' | 'UNSUPPORTED' | 'UNKNOWN';
export type CapabilityReport = Record<Capability, CapabilitySupport>;

export type DesiredNetworkState = 'ACTIVE' | 'SUSPENDED' | 'REVOKED';

/** What the gateway should enforce for one entitlement, computed from the database. */
export interface DesiredEntitlement {
  entitlementId: string;
  state: DesiredNetworkState;
  /** Devices (canonical MACs) allowed under this entitlement. */
  devices: string[];
  policy: {
    downloadKbps: number | null;
    uploadKbps: number | null;
    maxConcurrentSessions: number;
    /** Absolute end of access; null until the clock starts (first authorization). */
    expiresAt: string | null;
    /** Upper bound for a session when expiresAt is not yet known. */
    maxSessionSeconds: number;
  };
  /** Network zone identifiers this entitlement is limited to (room/floor scope), empty = property-wide. */
  zones: string[];
}

/** What the gateway reports it is actually enforcing (read-back). */
export interface ObservedEntitlement {
  entitlementId: string;
  present: boolean;
  state: DesiredNetworkState | null;
  devices: string[];
  policy: {
    downloadKbps: number | null;
    uploadKbps: number | null;
    maxConcurrentSessions: number | null;
    expiresAt: string | null;
  } | null;
}

export interface ObservedSession {
  gatewaySessionId: string;
  entitlementId: string | null;
  macAddress: string;
  ipAddress: string | null;
  startedAt: string;
  bytesIn: number | null;
  bytesOut: number | null;
}

export interface GatewayHealth {
  reachable: boolean;
  latencyMs: number | null;
  firmware: string | null;
  /** Short, safe description (no addresses, no credentials). */
  detail: string;
}

export const OPERATION_ERROR_CODES = [
  'UNREACHABLE',
  'TIMEOUT',
  'AUTH_FAILED',
  'UNSUPPORTED',
  'REJECTED',
  'CONFLICT',
  'NOT_FOUND',
] as const;
export type OperationErrorCode = (typeof OPERATION_ERROR_CODES)[number];

export type OperationResult =
  { ok: true } | { ok: false; code: OperationErrorCode; retryable: boolean; detail: string };

export interface NetworkAdapter {
  readonly vendor: string;
  getCapabilities(): CapabilityReport;
  healthCheck(): Promise<GatewayHealth>;
  /** Make the gateway enforce exactly this desired state (create, update, suspend). */
  applyEntitlement(desired: DesiredEntitlement): Promise<OperationResult>;
  /** Remove every trace of the entitlement and end its sessions. */
  revokeEntitlement(entitlementId: string): Promise<OperationResult>;
  /** End one device's session(s). */
  disconnectDevice(entitlementId: string, macAddress: string): Promise<OperationResult>;
  /** Read back what the gateway is actually enforcing. */
  readEntitlement(
    entitlementId: string,
  ): Promise<ObservedEntitlement | { unreachable: true; detail: string }>;
  listActiveSessions(): Promise<ObservedSession[] | { unreachable: true; detail: string }>;
  /**
   * Which device currently holds this client IP on the gateway's captive network?
   * The captive portal uses it to confirm the device identity a browser claims;
   * the browser's own claim is never trusted on its own.
   */
  lookupClient(
    clientIp: string,
  ): Promise<{ macAddress: string } | null | { unreachable: true; detail: string }>;
}

export const unsupported = (detail: string): OperationResult => ({
  ok: false,
  code: 'UNSUPPORTED',
  retryable: false,
  detail,
});

/** Capabilities a desired state needs; an adapter lacking any must refuse. */
export function requiredCapabilities(d: DesiredEntitlement): Capability[] {
  const caps: Capability[] = ['voucherAuth', 'scheduledExpiry', 'concurrentSessionLimit'];
  if (d.policy.downloadKbps !== null || d.policy.uploadKbps !== null)
    caps.push('perDeviceRateLimit');
  if (d.zones.length > 0) caps.push('zones');
  return caps;
}

/**
 * Compare desired vs observed. Returns the list of differences (empty = in sync).
 * Expiry is compared to the second; the gateway may round.
 */
export function diffEntitlement(d: DesiredEntitlement, o: ObservedEntitlement): string[] {
  const diffs: string[] = [];
  if (d.state === 'REVOKED') {
    if (o.present) diffs.push('present but should be revoked');
    return diffs;
  }
  if (!o.present) return ['missing on gateway'];
  if (o.state !== d.state) diffs.push(`state ${o.state ?? 'none'} ≠ ${d.state}`);
  const want = [...d.devices].sort().join(',');
  const have = [...o.devices].sort().join(',');
  if (want !== have) diffs.push('device list differs');
  if (!o.policy) return [...diffs, 'policy missing'];
  if (
    o.policy.downloadKbps !== d.policy.downloadKbps ||
    o.policy.uploadKbps !== d.policy.uploadKbps
  )
    diffs.push('rate limit differs');
  if (o.policy.maxConcurrentSessions !== d.policy.maxConcurrentSessions)
    diffs.push('session limit differs');
  const sec = (s: string | null) => (s ? Math.floor(Date.parse(s) / 1000) : null);
  if (sec(o.policy.expiresAt) !== sec(d.policy.expiresAt)) diffs.push('expiry differs');
  return diffs;
}
