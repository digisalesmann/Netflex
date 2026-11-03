import { createHash, randomBytes } from 'node:crypto';
import type { Gateway, Prisma, PrismaClient } from '@netflex/database';
import {
  CAPABILITIES,
  requiredCapabilities,
  unsupported,
  type CapabilityReport,
  type ClientQuery,
  type DesiredEntitlement,
  type GatewayHealth,
  type LinkCommandKind,
  type LinkCommandPayloads,
  type LinkCommandResults,
  type NetworkAdapter,
  type ObservedEntitlement,
  type ObservedSession,
  type OperationResult,
} from '@netflex/network';

/** A link that hasn't checked in for this long counts as offline. Links poll every ~25 s. */
export const LINK_ONLINE_WINDOW_MS = 90_000;
/** Instructions not collected within this time are dropped, so a link that wakes up late never acts on stale ones. */
export const LINK_COMMAND_TTL_MS = 60_000;

const CONFIRM_TTL_MS = 2 * 60_000;
const CONFIRMED = new Map<string, number>();

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** One-time pairing code shown in the office, e.g. "K7QH-3MZP". */
export function newPairingCode(): string {
  const b = randomBytes(8);
  const c = Array.from(b, (x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}
export const normalizePairingCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
export const newLinkToken = () => `nfl_${randomBytes(32).toString('base64url')}`;

export type LinkCallResult<K extends LinkCommandKind> =
  | { ok: true; result: LinkCommandResults[K] }
  | { ok: false; code: 'UNREACHABLE' | 'TIMEOUT' | 'REJECTED'; detail: string };

/**
 * Queues instructions for a lodge link and waits for its answer. The API and the
 * worker are separate processes, so the database is the meeting point: the
 * instruction row is written here, the link collects it on its next check-in
 * (it long-polls, so usually within a second), and its result lands on the same row.
 */
export class LinkBroker {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly opts: { timeoutMs?: number; pollMs?: number } = {},
  ) {}

  async status(gatewayId: string) {
    const l = await this.prisma.lodgeLink.findUnique({ where: { gatewayId } });
    const online =
      !!l?.tokenHash &&
      !!l.lastSeenAt &&
      Date.now() - l.lastSeenAt.getTime() < LINK_ONLINE_WINDOW_MS;
    const f = (l?.features ?? {}) as { unauthorize?: boolean; listClients?: boolean };
    return {
      paired: !!l?.tokenHash,
      online,
      controllerOk: online && !!l?.controllerOk,
      controllerVersion: l?.controllerVersion ?? null,
      detail: l?.detail ?? null,
      lastSeenAt: l?.lastSeenAt ?? null,
      features: { unauthorize: f.unauthorize === true, listClients: f.listClients === true },
    };
  }

  async call<K extends LinkCommandKind>(
    gatewayId: string,
    kind: K,
    payload: LinkCommandPayloads[K],
  ): Promise<LinkCallResult<K>> {
    const st = await this.status(gatewayId);
    if (!st.paired) return { ok: false, code: 'UNREACHABLE', detail: 'lodge link not paired' };
    if (!st.online) return { ok: false, code: 'UNREACHABLE', detail: 'lodge link offline' };
    const cmd = await this.prisma.linkCommand.create({
      data: { gatewayId, kind, payload: payload as unknown as Prisma.InputJsonValue },
    });
    const deadline = Date.now() + (this.opts.timeoutMs ?? 20_000);
    const pollMs = this.opts.pollMs ?? 250;
    for (;;) {
      const c = await this.prisma.linkCommand.findUniqueOrThrow({ where: { id: cmd.id } });
      if (c.status === 'DONE') return { ok: true, result: c.result as LinkCommandResults[K] };
      if (c.status === 'FAILED')
        return {
          ok: false,
          code: 'REJECTED',
          detail: c.error ?? 'the lodge link reported a failure',
        };
      if (Date.now() > deadline) {
        // Never collected: drop it so it can't run later. Collected but unanswered: the
        // operation is retried as a whole and every instruction is safe to repeat.
        await this.prisma.linkCommand.updateMany({
          where: { id: cmd.id, status: 'PENDING' },
          data: { status: 'EXPIRED' },
        });
        return { ok: false, code: 'TIMEOUT', detail: 'the lodge link did not answer in time' };
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
}

/**
 * Omada (TP-Link) through a lodge link. Devices are switched on with Omada's
 * documented external-portal API, with the plan's end time, so Omada itself cuts
 * them off when time is up even if the link or the internet is down.
 * Switching off early and listing devices need the controller's Open API; the
 * link says whether it has that (features), and anything it can't do is refused
 * honestly instead of pretended.
 */
export class OmadaLinkAdapter implements NetworkAdapter {
  readonly vendor = 'OMADA';

  constructor(
    private readonly prisma: PrismaClient,
    private readonly broker: LinkBroker,
    private readonly gateway: Gateway,
  ) {}

  getCapabilities(): CapabilityReport {
    const report = Object.fromEntries(
      CAPABILITIES.map((c) => [c, 'UNSUPPORTED']),
    ) as CapabilityReport;
    for (const c of [
      'captivePortal',
      'voucherAuth',
      'externalPortal',
      'apiAutomation',
      'scheduledExpiry',
      'healthStatus',
      'secureRemoteManagement',
      // One authorization per device; the device count is enforced by NetFlex.
      'concurrentSessionLimit',
    ] as const)
      report[c] = 'SUPPORTED';
    // Depends on the controller's Open API being set up on the lodge computer.
    report.sessionDisconnect = 'UNKNOWN';
    return report;
  }

  async healthCheck(): Promise<GatewayHealth> {
    const s = await this.broker.status(this.gateway.id);
    if (!s.paired)
      return { reachable: false, latencyMs: null, firmware: null, detail: 'Lodge link not set up' };
    if (!s.online)
      return { reachable: false, latencyMs: null, firmware: null, detail: 'Lodge link offline' };
    return {
      reachable: s.controllerOk,
      latencyMs: null,
      firmware: s.controllerVersion ? `Omada ${s.controllerVersion}` : null,
      detail: (
        s.detail ?? (s.controllerOk ? 'Controller answering' : 'Controller not answering')
      ).slice(0, 120),
    };
  }

  private async contexts(macs: string[]) {
    const rows = await this.prisma.portalClient.findMany({
      where: { gatewayId: this.gateway.id, macAddress: { in: macs } },
    });
    return new Map(rows.map((r) => [r.macAddress, r]));
  }

  private async site(macs: string[]): Promise<string> {
    const row = await this.prisma.portalClient.findFirst({
      where: { gatewayId: this.gateway.id, ...(macs.length ? { macAddress: { in: macs } } : {}) },
      orderBy: { seenAt: 'desc' },
      select: { site: true },
    });
    return row?.site ?? '';
  }

  private async switchOff(macs: string[]): Promise<OperationResult & { done?: string[] }> {
    if (!macs.length) return { ok: true, done: [] };
    const r = await this.broker.call(this.gateway.id, 'unauthorize', {
      macs,
      site: await this.site(macs),
    });
    if (!r.ok)
      return { ok: false, code: r.code, retryable: r.code !== 'REJECTED', detail: r.detail };
    if ('unsupported' in r.result)
      return unsupported(
        'switching a device off early needs the Omada Open API on the lodge link (see the setup guide)',
      );
    if (r.result.failed.length)
      return {
        ok: false,
        code: 'REJECTED',
        retryable: true,
        detail:
          `controller refused ${r.result.failed.length} device(s): ${r.result.failed[0]?.detail ?? ''}`.slice(
            0,
            200,
          ),
      };
    return { ok: true, done: r.result.done };
  }

  private async saveGrant(
    entitlementId: string,
    state: string,
    devices: string[],
    d: DesiredEntitlement | null,
  ) {
    const data = {
      gatewayId: this.gateway.id,
      state,
      devices: [...new Set(devices)].sort(),
      expiresAt: d?.policy.expiresAt ? new Date(d.policy.expiresAt) : null,
      maxSessions: d?.policy.maxConcurrentSessions ?? 1,
    };
    await this.prisma.linkGrant.upsert({
      where: { entitlementId },
      create: { entitlementId, ...data },
      update: data,
    });
  }

  async applyEntitlement(d: DesiredEntitlement): Promise<OperationResult> {
    const caps = this.getCapabilities();
    const missing = requiredCapabilities(d).filter((c) => caps[c] !== 'SUPPORTED');
    if (missing.length) return unsupported(`Omada can't enforce: ${missing.join(', ')}`);
    const grant = await this.prisma.linkGrant.findUnique({
      where: { entitlementId: d.entitlementId },
    });
    const before = grant?.devices ?? [];

    if (d.state === 'SUSPENDED') {
      const off = await this.switchOff(before);
      if (!off.ok) return off;
      await this.saveGrant(d.entitlementId, 'SUSPENDED', d.devices, d);
      return { ok: true };
    }
    if (d.state !== 'ACTIVE') return this.revokeEntitlement(d.entitlementId);

    // Devices taken off the plan are switched off first.
    const removed = before.filter((m) => !d.devices.includes(m));
    const off = await this.switchOff(removed);
    if (!off.ok) return off;

    const ctx = await this.contexts(d.devices);
    const unknown = d.devices.filter((m) => !ctx.has(m));
    if (unknown.length)
      return {
        ok: false,
        code: 'NOT_FOUND',
        retryable: true,
        detail: `${unknown.length} device(s) haven't opened the Wi-Fi sign-in page yet`,
      };
    const untilMs = d.policy.expiresAt
      ? Date.parse(d.policy.expiresAt)
      : Date.now() + d.policy.maxSessionSeconds * 1000;
    if (untilMs <= Date.now()) return this.revokeEntitlement(d.entitlementId);
    if (d.devices.length) {
      const r = await this.broker.call(this.gateway.id, 'authorize', {
        clients: d.devices.flatMap((m) => {
          const c = ctx.get(m);
          return c
            ? [{ mac: m, apMac: c.apMac, ssidName: c.ssidName, radioId: c.radioId, site: c.site }]
            : [];
        }),
        untilMs,
      });
      if (!r.ok)
        return { ok: false, code: r.code, retryable: r.code !== 'REJECTED', detail: r.detail };
      if (r.result.failed.length) {
        // Keep what the controller did accept, so read-back shows the truth.
        await this.saveGrant(d.entitlementId, 'ACTIVE', r.result.authorized, d);
        return {
          ok: false,
          code: 'REJECTED',
          retryable: true,
          detail:
            `controller refused ${r.result.failed.length} device(s): ${r.result.failed[0]?.detail ?? ''}`.slice(
              0,
              200,
            ),
        };
      }
    }
    await this.saveGrant(d.entitlementId, 'ACTIVE', d.devices, d);
    return { ok: true };
  }

  async revokeEntitlement(entitlementId: string): Promise<OperationResult> {
    const grant = await this.prisma.linkGrant.findUnique({ where: { entitlementId } });
    if (!grant) return { ok: true };
    const off = await this.switchOff(grant.state === 'ACTIVE' ? grant.devices : []);
    if (!off.ok) return off;
    await this.prisma.linkGrant.delete({ where: { entitlementId } });
    return { ok: true };
  }

  async disconnectDevice(entitlementId: string, macAddress: string): Promise<OperationResult> {
    const off = await this.switchOff([macAddress]);
    if (!off.ok) return off;
    const grant = await this.prisma.linkGrant.findUnique({ where: { entitlementId } });
    if (grant)
      await this.prisma.linkGrant.update({
        where: { entitlementId },
        data: { devices: grant.devices.filter((m) => m !== macAddress) },
      });
    return { ok: true };
  }

  /**
   * What the controller has acknowledged for this entitlement. Omada confirms each
   * switch-on/off call (errorCode 0) and only those confirmations are recorded here.
   */
  async readEntitlement(
    entitlementId: string,
  ): Promise<ObservedEntitlement | { unreachable: true; detail: string }> {
    const g = await this.prisma.linkGrant.findUnique({ where: { entitlementId } });
    if (!g) return { entitlementId, present: false, state: null, devices: [], policy: null };
    return {
      entitlementId,
      present: true,
      state: g.state === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE',
      devices: g.devices,
      policy: {
        downloadKbps: null,
        uploadKbps: null,
        maxConcurrentSessions: g.maxSessions,
        expiresAt: g.expiresAt?.toISOString() ?? null,
      },
    };
  }

  async listActiveSessions(): Promise<ObservedSession[] | { unreachable: true; detail: string }> {
    const r = await this.broker.call(this.gateway.id, 'listClients', { site: await this.site([]) });
    if (!r.ok) return { unreachable: true, detail: r.detail };
    if ('unsupported' in r.result)
      return {
        unreachable: true,
        detail: 'device list needs the Omada Open API on the lodge link',
      };
    const grants = await this.prisma.linkGrant.findMany({
      where: { gatewayId: this.gateway.id, state: 'ACTIVE' },
      select: { entitlementId: true, devices: true },
    });
    const owner = new Map<string, string>();
    for (const g of grants) for (const m of g.devices) owner.set(m, g.entitlementId);
    return r.result.clients
      .filter((c) => c.authorized !== false)
      .map((c) => ({
        gatewaySessionId: `omada:${c.mac}`,
        entitlementId: owner.get(c.mac) ?? null,
        macAddress: c.mac,
        ipAddress: c.ip,
        startedAt: c.connectedSince ?? new Date().toISOString(),
        bytesIn: null,
        bytesOut: null,
      }));
  }

  async lookupClient(
    q: ClientQuery,
  ): Promise<{ macAddress: string } | null | { unreachable: true; detail: string }> {
    const ctx = await this.prisma.portalClient.findUnique({
      where: { gatewayId_macAddress: { gatewayId: this.gateway.id, macAddress: q.mac } },
    });
    if (!ctx) return null;
    // The sign-in page asks often; one confirmation per device holds for a short while.
    const key = `${this.gateway.id}:${q.mac}`;
    if ((CONFIRMED.get(key) ?? 0) > Date.now()) return { macAddress: q.mac };
    const r = await this.broker.call(this.gateway.id, 'findClient', { mac: q.mac, site: ctx.site });
    if (!r.ok) return { unreachable: true, detail: r.detail };
    // Without the Open API the link can't look; the redirect came from the controller, and
    // a wrong MAC could only ever switch on a device chosen by whoever holds the paid code.
    if ('unsupported' in r.result || r.result.connected) {
      if (CONFIRMED.size > 5000) CONFIRMED.clear();
      CONFIRMED.set(key, Date.now() + CONFIRM_TTL_MS);
      return { macAddress: q.mac };
    }
    return null;
  }
}
