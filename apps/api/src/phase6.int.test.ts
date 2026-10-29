import { randomBytes } from 'node:crypto';
import {
  RetryableNetworkError,
  expireDue,
  type DefaultAdapterRegistry,
  type NetworkEngine,
  type PaymentEngine,
} from '@netflex/core';
import type { FakeNetworkAdapter } from '@netflex/network';
import { createLogger } from '@netflex/observability';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CSRF,
  createStaff,
  signInStaff,
  startHarness,
  uniq,
  type Agent,
  type Harness,
} from '../../../scripts/test/api-harness.js';
import { relayOutboxBatch } from '../../worker/src/outbox-relay.js';
import { createPaymentProcessor, type JobLike } from '../../worker/src/processors.js';
import type { JobSink } from '../../worker/src/queues.js';
import { ADAPTER_REGISTRY, NETWORK_ENGINE, PAYMENT_ENGINE } from './infra/tokens.js';
import { RedemptionService } from './vouchers/redemption.service.js';

let h: Harness;
let gw: FakeNetworkAdapter;
let network: NetworkEngine;
let redemption: RedemptionService;
const secrets = new Map<string, string>();
const ag = {} as Record<'owner' | 'admin' | 'network' | 'finance', Agent>;
let P: { id: string; room: string };
let NoGw: { id: string };
let plan: string;
let firstAuthPlan: string;

const mac = () =>
  Array.from(randomBytes(6), (b, i) => (i === 0 ? b & 0xfc : b).toString(16).padStart(2, '0')).join(
    ':',
  );
const base = (pid = P.id) => `/api/v1/admin/properties/${pid}`;
const log = createLogger({ service: 'worker', environment: 'test', level: 'fatal' });

/**
 * Relay the outbox and run network jobs through the real worker processor,
 * re-running jobs that ask for a retry (as BullMQ would, minus the delay).
 */
async function drain(maxRounds = 12) {
  const processor = createPaymentProcessor(
    h.app.get<PaymentEngine>(PAYMENT_ENGINE),
    log,
    h.prisma,
    network,
  );
  const results: unknown[] = [];
  let pending: JobLike[] = [];
  for (let round = 0; round < maxRounds; round++) {
    const jobs: JobLike[] = [];
    const sink: JobSink = {
      add: async (_q, name, data, jobId) => void jobs.push({ id: jobId, name, data }),
      close: async () => {},
    };
    await relayOutboxBatch(h.prisma, sink, 500);
    const batch = [...pending, ...jobs.filter((j) => j.name.startsWith('network.'))];
    pending = [];
    if (!batch.length) break;
    for (const j of batch) {
      try {
        results.push(
          await processor({
            ...j,
            data: { ...j.data, outboxEventId: j.data.outboxEventId ?? j.id },
          }),
        );
      } catch (e) {
        if (e instanceof RetryableNetworkError) pending.push(j);
        else throw e;
      }
    }
  }
  return results;
}

async function publish(over: Record<string, unknown> = {}) {
  const c = await ag.admin
    .post(`${base()}/plans`)
    .set(CSRF)
    .send({
      slug: `n-${uniq()}`,
      version: {
        name: 'Day',
        description: 'd',
        scope: 'INDIVIDUAL',
        price: '500',
        duration: { value: 1, unit: 'DAY' },
        activationPolicy: 'ON_FIRST_REDEMPTION',
        redemptionWindow: { value: 30, unit: 'DAY' },
        maxDevices: 2,
        maxConcurrentSessions: 2,
        downloadKbps: 5000,
        uploadKbps: 1000,
        maxGroupMembers: null,
        renewalRule: 'STACK_AFTER_CURRENT_EXPIRY',
        availableFrom: null,
        availableUntil: null,
        fairUseText: null,
        refundPolicyText: 'r',
        termsVersion: 't',
        ...over,
      },
    });
  await ag.admin
    .post(`${base()}/plans/${c.body.data.planId}/versions/${c.body.data.versionId}/publish`)
    .set(CSRF)
    .send({})
    .expect(200);
  return c.body.data.versionId as string;
}

async function issueAndRedeem(versionId = plan, device = mac()) {
  const r = await ag.admin
    .post(`${base()}/vouchers`)
    .set(CSRF)
    .send({
      planVersionId: versionId,
      issuanceType: 'MANUAL',
      reason: 'network test',
      target: { scope: 'INDIVIDUAL' },
    });
  const code = r.body.data.vouchers[0].code as string;
  const v = await h.prisma.voucher.findUniqueOrThrow({
    where: { id: r.body.data.vouchers[0].voucherId },
  });
  await redemption.redeem({
    propertyId: P.id,
    code,
    macAddress: device,
    userId: null,
    clientKey: uniq(),
  });
  return { code, device, entitlementId: v.entitlementId as string };
}

const ent = (id: string) => h.prisma.entitlement.findUniqueOrThrow({ where: { id } });
const ops = (id: string) =>
  h.prisma.networkOperation.findMany({
    where: { entitlementId: id },
    orderBy: { createdAt: 'asc' },
  });

beforeAll(async () => {
  h = await startHarness({ NETWORK_ADAPTER: 'fake' });
  gw = (h.app.get(ADAPTER_REGISTRY) as DefaultAdapterRegistry).fake as FakeNetworkAdapter;
  network = h.app.get(NETWORK_ENGINE);
  redemption = h.app.get(RedemptionService);
  // Only this file's network work should be relayed.
  await h.prisma.outboxEvent.updateMany({
    where: { dispatchedAt: null },
    data: { dispatchedAt: new Date() },
  });

  ag.owner = await signInStaff(
    h,
    await createStaff(h.prisma, [{ role: 'OWNER', propertyId: null }]),
    secrets,
  );
  const pid = (
    await ag.owner
      .post('/api/v1/admin/properties')
      .set(CSRF)
      .send({ slug: `p6-${uniq()}`, name: 'Net Lodge' })
  ).body.data.id as string;
  const b = (
    await ag.owner
      .post(`/api/v1/admin/properties/${pid}/buildings`)
      .set(CSRF)
      .send({ name: 'Main' })
  ).body.data.id as string;
  const f = (
    await ag.owner
      .post(`/api/v1/admin/properties/${pid}/buildings/${b}/floors`)
      .set(CSRF)
      .send({ label: 'G', level: 0 })
  ).body.data.id as string;
  const room = (
    await ag.owner
      .post(`/api/v1/admin/properties/${pid}/floors/${f}/rooms`)
      .set(CSRF)
      .send({ label: 'G1' })
  ).body.data.id as string;
  P = { id: pid, room };
  NoGw = {
    id: (
      await ag.owner
        .post('/api/v1/admin/properties')
        .set(CSRF)
        .send({ slug: `p6n-${uniq()}`, name: 'No Gateway' })
    ).body.data.id as string,
  };
  ag.admin = await signInStaff(
    h,
    await createStaff(h.prisma, [
      { role: 'PROPERTY_ADMIN', propertyId: P.id },
      { role: 'PROPERTY_ADMIN', propertyId: NoGw.id },
    ]),
    secrets,
  );
  ag.network = await signInStaff(
    h,
    await createStaff(h.prisma, [{ role: 'NETWORK_ADMIN', propertyId: P.id }]),
    secrets,
  );
  ag.finance = await signInStaff(
    h,
    await createStaff(h.prisma, [{ role: 'FINANCE', propertyId: P.id }]),
    secrets,
  );
  plan = await publish();
  firstAuthPlan = await publish({ activationPolicy: 'ON_FIRST_AUTHORIZATION' });
  const g = await ag.network.post(`${base()}/gateways`).set(CSRF).send({
    name: 'Main router',
    vendor: 'FAKE',
    model: 'simulated',
    credentialRef: 'MAIN_ROUTER',
  });
  expect(g.status).toBe(201);
}, 180_000);

beforeEach(() => {
  gw.setDown(false);
  gw.capabilities.perDeviceRateLimit = 'SUPPORTED';
  gw.capabilities.sessionDisconnect = 'SUPPORTED';
});

afterAll(async () => {
  await h.close();
});

// ====================================================================== activation
describe('activation is confirmed by read-back before access counts as active', () => {
  it('redeem → gateway applies policy → read-back matches → ACTIVE', async () => {
    const a = await issueAndRedeem();
    expect((await ent(a.entitlementId)).status).toBe('PROVISIONING');
    await drain();
    const e = await ent(a.entitlementId);
    expect(e.status).toBe('ACTIVE');
    expect(e.observedNetworkState).toBe('ACTIVE');
    const on = gw.peek(a.entitlementId);
    expect(on?.devices).toEqual([a.device]);
    expect(on?.policy).toMatchObject({
      downloadKbps: 5000,
      uploadKbps: 1000,
      maxConcurrentSessions: 2,
      expiresAt: e.expiresAt?.toISOString(),
    });
    const [op] = await ops(a.entitlementId);
    expect(op?.status).toBe('SUCCEEDED');
    expect(op?.verification).toMatchObject({ inSync: true });
    const detail = await ag.admin.get(`${base()}/entitlements/${a.entitlementId}`).expect(200);
    // A 1-day plan is always within 24 h of expiry, so the confirmed-active state reads EXPIRING_SOON.
    expect(detail.body.data.customerState).toBe('EXPIRING_SOON');
  });

  it('a change the gateway "accepts" but does not apply is caught and retried', async () => {
    gw.injectFault('silently-ignore');
    const a = await issueAndRedeem();
    await drain();
    const [op] = await ops(a.entitlementId);
    expect(op?.status).toBe('SUCCEEDED');
    expect(op?.attempts).toBe(2);
    expect((await ent(a.entitlementId)).status).toBe('ACTIVE');
  });

  it('when verification keeps failing: PROVISIONING_FAILED, discrepancy, then an authorized retry recovers', async () => {
    gw.injectFault('silently-ignore', 8);
    const a = await issueAndRedeem();
    await drain();
    const [op] = await ops(a.entitlementId);
    expect(op).toMatchObject({ status: 'FAILED', lastErrorCode: 'VERIFY_MISMATCH', attempts: 8 });
    expect((await ent(a.entitlementId)).status).toBe('PROVISIONING_FAILED');
    expect(
      await h.prisma.reconciliationDiscrepancy.count({
        where: { entitlementId: a.entitlementId, kind: 'NETWORK_DRIFT' },
      }),
    ).toBe(1);
    const detail = await ag.admin.get(`${base()}/entitlements/${a.entitlementId}`);
    expect(detail.body.data.customerState).toBe('PROVISIONING_NEEDS_ATTENTION');

    await ag.finance
      .post(`${base()}/network/operations/${op?.id}/retry`)
      .set(CSRF)
      .send({ reason: 'try' })
      .expect(404);
    await ag.network
      .post(`${base()}/network/operations/${op?.id}/retry`)
      .set(CSRF)
      .send({ reason: 'router rebooted' })
      .expect(200);
    await drain();
    expect((await ent(a.entitlementId)).status).toBe('ACTIVE');
    await ag.network
      .post(`${base()}/network/operations/${op?.id}/retry`)
      .set(CSRF)
      .send({ reason: 'again' })
      .expect(409);
  });

  it('an unreachable gateway is retried until it comes back', async () => {
    gw.setDown(true);
    const a = await issueAndRedeem();
    await drain(3);
    expect((await ops(a.entitlementId))[0]?.status).toBe('RETRY_SCHEDULED');
    gw.setDown(false);
    // The queued retry job is gone in this harness (as if Redis lost it). Once its retry time
    // has passed, the sweep must pick it up.
    await h.prisma.networkOperation.updateMany({
      where: { entitlementId: a.entitlementId },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });
    expect(await network.resumeStalledOperations(0)).toBeGreaterThanOrEqual(1);
    expect((await ent(a.entitlementId)).status).toBe('ACTIVE');
  });

  it('never pretends: an unsupported capability fails immediately and loudly', async () => {
    gw.capabilities.perDeviceRateLimit = 'UNSUPPORTED';
    const a = await issueAndRedeem();
    await drain();
    const [op] = await ops(a.entitlementId);
    expect(op).toMatchObject({ status: 'FAILED', lastErrorCode: 'UNSUPPORTED', attempts: 1 });
    expect(gw.peek(a.entitlementId)).toBeUndefined();
    expect((await ent(a.entitlementId)).status).toBe('PROVISIONING_FAILED');
  });

  it('rejected credentials are not retried blindly', async () => {
    gw.injectFault('auth');
    const a = await issueAndRedeem();
    await drain();
    expect((await ops(a.entitlementId))[0]).toMatchObject({
      status: 'FAILED',
      lastErrorCode: 'AUTH_FAILED',
      attempts: 1,
    });
  });

  it('with no gateway registered, access stays "being configured" (not failed) and nothing is invented', async () => {
    const pl = await ag.admin
      .post(`${base(NoGw.id)}/plans`)
      .set(CSRF)
      .send({
        slug: `x-${uniq()}`,
        version: {
          name: 'No gateway plan',
          description: 'd',
          scope: 'INDIVIDUAL',
          price: '1',
          duration: { value: 1, unit: 'DAY' },
          activationPolicy: 'ON_FIRST_REDEMPTION',
          redemptionWindow: null,
          maxDevices: 1,
          maxConcurrentSessions: 1,
          downloadKbps: null,
          uploadKbps: null,
          maxGroupMembers: null,
          renewalRule: 'REPLACE',
          availableFrom: null,
          availableUntil: null,
          fairUseText: null,
          refundPolicyText: 'r',
          termsVersion: 't',
        },
      });
    await ag.admin
      .post(
        `${base(NoGw.id)}/plans/${pl.body.data.planId}/versions/${pl.body.data.versionId}/publish`,
      )
      .set(CSRF)
      .send({})
      .expect(200);
    const r = await ag.admin
      .post(`${base(NoGw.id)}/vouchers`)
      .set(CSRF)
      .send({
        planVersionId: pl.body.data.versionId,
        issuanceType: 'MANUAL',
        reason: 'no gateway test',
        target: { scope: 'INDIVIDUAL' },
      });
    expect(r.status).toBe(201);
    const v = await h.prisma.voucher.findUniqueOrThrow({
      where: { id: r.body.data.vouchers[0].voucherId },
    });
    await redemption.redeem({
      propertyId: NoGw.id,
      code: r.body.data.vouchers[0].code,
      macAddress: mac(),
      userId: null,
      clientKey: uniq(),
    });
    await drain();
    const [op] = await ops(v.entitlementId as string);
    expect(op).toMatchObject({ status: 'FAILED', lastErrorCode: 'NO_GATEWAY_CONFIGURED' });
    const e = await ent(v.entitlementId as string);
    expect(e.status).toBe('PROVISIONING');
    expect(e.observedNetworkState).toBeNull();
  });
});

// ====================================================================== lifecycle effects
describe('lifecycle changes reach the gateway', () => {
  it('suspend, reactivate, device release, revoke', async () => {
    const a = await issueAndRedeem();
    await drain();
    gw.addSession(a.entitlementId, a.device);
    await ag.admin
      .post(`${base()}/entitlements/${a.entitlementId}/suspend`)
      .set(CSRF)
      .send({ reason: 'abuse report' })
      .expect(200);
    await drain();
    expect(gw.peek(a.entitlementId)?.state).toBe('SUSPENDED');
    expect(((await gw.listActiveSessions()) as unknown[]).length).toBe(0);
    expect((await ent(a.entitlementId)).observedNetworkState).toBe('SUSPENDED');

    await ag.admin
      .post(`${base()}/entitlements/${a.entitlementId}/reactivate`)
      .set(CSRF)
      .send({ reason: 'cleared' })
      .expect(200);
    await drain();
    expect(gw.peek(a.entitlementId)?.state).toBe('ACTIVE');
    expect((await ent(a.entitlementId)).status).toBe('ACTIVE');

    const red = await h.prisma.voucherRedemption.findFirstOrThrow({
      where: { entitlementId: a.entitlementId, releasedAt: null },
    });
    await ag.admin
      .post(`${base()}/entitlements/${a.entitlementId}/devices/${red.id}/release`)
      .set(CSRF)
      .send({ reason: 'lost phone' })
      .expect(200);
    await drain();
    expect(gw.peek(a.entitlementId)?.devices).toEqual([]);

    await ag.admin
      .post(`${base()}/entitlements/${a.entitlementId}/revoke`)
      .set(CSRF)
      .send({ reason: 'moved out' })
      .expect(200);
    await drain();
    expect(gw.peek(a.entitlementId)).toBeUndefined();
    expect((await ent(a.entitlementId)).observedNetworkState).toBe('REVOKED');
  });

  it('expiry removes access from the gateway', async () => {
    const a = await issueAndRedeem();
    await drain();
    await h.prisma
      .$executeRaw`UPDATE "entitlements" SET "startsAt" = now() - interval '2 days', "expiresAt" = now() - interval '1 second' WHERE "id" = ${a.entitlementId}::uuid`;
    await expireDue(h.prisma);
    await drain();
    expect(gw.peek(a.entitlementId)).toBeUndefined();
  });

  it('out-of-order commands converge on the database truth', async () => {
    const a = await issueAndRedeem();
    // Revoke first, then let a stale activate command run after it.
    await ag.admin
      .post(`${base()}/entitlements/${a.entitlementId}/revoke`)
      .set(CSRF)
      .send({ reason: 'fraud' })
      .expect(200);
    await drain();
    expect(gw.peek(a.entitlementId)).toBeUndefined();
    await h.prisma.outboxEvent.create({
      data: {
        type: 'network.activate',
        aggregateType: 'entitlement',
        aggregateId: a.entitlementId,
        payload: { entitlementId: a.entitlementId },
      },
    });
    await drain();
    expect(gw.peek(a.entitlementId)).toBeUndefined();
  });
});

// ====================================================================== reconciliation
describe('network reconciliation', () => {
  it('detects drift (config removed on the router) and repairs it', async () => {
    const a = await issueAndRedeem();
    await drain();
    gw.tamper(a.entitlementId);
    const r = await network.reconcileProperty(P.id);
    expect(r.drift).toBeGreaterThanOrEqual(1);
    await drain();
    expect(gw.peek(a.entitlementId)?.state).toBe('ACTIVE');
    expect(
      await h.prisma.reconciliationDiscrepancy.count({
        where: { entitlementId: a.entitlementId, kind: 'NETWORK_DRIFT' },
      }),
    ).toBe(1);
  });

  it('changes nothing while the gateway is unreachable', async () => {
    const a = await issueAndRedeem();
    await drain();
    gw.tamper(a.entitlementId);
    gw.setDown(true);
    const before = await h.prisma.outboxEvent.count();
    const r = await network.reconcileProperty(P.id);
    expect(r.reachable).toBe(false);
    expect(await h.prisma.outboxEvent.count()).toBe(before);
    expect((await h.prisma.gateway.findFirstOrThrow({ where: { propertyId: P.id } })).status).toBe(
      'UNREACHABLE',
    );
    gw.setDown(false);
    await network.reconcileProperty(P.id);
    await drain();
  });

  it('cuts a live session whose access has ended, and flags sessions with no access at all', async () => {
    const a = await issueAndRedeem();
    await drain();
    await h.prisma.entitlement.update({
      where: { id: a.entitlementId },
      data: { status: 'REVOKED', desiredNetworkState: 'REVOKED' },
    });
    gw.addSession(a.entitlementId, a.device);
    gw.addSession(null, mac(), `rogue-${uniq()}`);
    const r = await network.reconcileProperty(P.id);
    expect(r.revokesQueued).toBe(1);
    expect(r.unknownSessions).toBeGreaterThanOrEqual(1);
    await drain();
    expect(
      ((await gw.listActiveSessions()) as { entitlementId: string | null }[]).some(
        (s) => s.entitlementId === a.entitlementId,
      ),
    ).toBe(false);
    expect(
      await h.prisma.reconciliationDiscrepancy.count({
        where: { propertyId: P.id, kind: 'SESSION_WITHOUT_ENTITLEMENT' },
      }),
    ).toBeGreaterThanOrEqual(1);
  });

  it('ON_FIRST_AUTHORIZATION: the clock starts at the first real login seen on the gateway', async () => {
    const a = await issueAndRedeem(firstAuthPlan);
    await drain();
    let e = await ent(a.entitlementId);
    expect(e.startsAt).toBeNull();
    expect(e.status).toBe('PROVISIONING'); // confirmed on the gateway, but no login yet
    expect(e.observedNetworkState).toBe('ACTIVE');

    gw.addSession(a.entitlementId, a.device);
    const before = Date.now();
    const r = await network.reconcileProperty(P.id);
    expect(r.clocksStarted).toBe(1);
    e = await ent(a.entitlementId);
    expect(e.status).toBe('ACTIVE');
    expect((e.expiresAt?.getTime() ?? 0) - (e.startsAt?.getTime() ?? 0)).toBe(86_400_000);
    expect(e.startsAt?.getTime()).toBeGreaterThanOrEqual(before - 1000);
    await drain();
    expect(gw.peek(a.entitlementId)?.policy?.expiresAt).toBe(e.expiresAt?.toISOString());
    expect(
      await h.prisma.networkSession.count({
        where: { entitlementId: a.entitlementId, endedAt: null },
      }),
    ).toBe(1);
  });

  it('runs as the worker job', async () => {
    const processor = createPaymentProcessor(
      h.app.get<PaymentEngine>(PAYMENT_ENGINE),
      log,
      h.prisma,
      network,
    );
    const r = (await processor({ name: 'reconcile.network', data: {} })) as Record<
      string,
      { reachable: boolean }
    >;
    expect(r[P.id]?.reachable).toBe(true);
  });
});

// ====================================================================== admin API safety
describe('gateway administration', () => {
  it('reports health and capabilities honestly', async () => {
    const g = await h.prisma.gateway.findFirstOrThrow({ where: { propertyId: P.id } });
    const r = await ag.network.post(`${base()}/gateways/${g.id}/health-check`).set(CSRF).send({});
    expect(r.body.data).toMatchObject({
      reachable: true,
      capabilities: { perDeviceRateLimit: 'SUPPORTED' },
    });
    const list = await ag.network.get(`${base()}/gateways`).expect(200);
    expect(list.body.data[0].status).toBe('HEALTHY');
    expect(JSON.stringify(list.body)).not.toMatch(/password|secret|https?:\/\//i);
  });

  it('accepts only a secret NAME, never URLs, IPs or credentials', async () => {
    for (const credentialRef of [
      'https://192.168.88.1',
      '192.168.88.1',
      'admin:password',
      'lower_case',
    ]) {
      await ag.network
        .post(`${base()}/gateways`)
        .set(CSRF)
        .send({ name: `G ${uniq()}`, vendor: 'MIKROTIK', credentialRef })
        .expect(400);
    }
    await ag.network
      .post(`${base()}/gateways`)
      .set(CSRF)
      .send({
        name: `G ${uniq()}`,
        vendor: 'MIKROTIK',
        credentialRef: 'ROUTER_A',
        host: '10.0.0.1',
      })
      .expect(400);
  });

  it('a real-vendor gateway is honest that no adapter exists yet', async () => {
    const r = await ag.network
      .post(`${base(P.id)}/gateways`)
      .set(CSRF)
      .send({ name: `Mikrotik ${uniq()}`, vendor: 'MIKROTIK', credentialRef: 'MT_ROUTER' });
    const hc = await ag.network
      .post(`${base()}/gateways/${r.body.data.id}/health-check`)
      .set(CSRF)
      .send({});
    expect(hc.body.data).toMatchObject({
      reachable: false,
      detail: 'no adapter for vendor MIKROTIK',
    });
    await ag.network
      .post(`${base()}/gateways/${r.body.data.id}/disable`)
      .set(CSRF)
      .send({ reason: 'not installed yet' })
      .expect(200);
  });

  it('there is no endpoint for running router commands, and other roles cannot operate the network', async () => {
    await ag.owner
      .post(`${base()}/network/command`)
      .set(CSRF)
      .send({ command: '/system reboot' })
      .expect(404);
    await ag.finance.get(`${base()}/gateways`).expect(404);
    await ag.finance.post(`${base()}/network/reconcile`).set(CSRF).send({}).expect(404);
    await ag.admin
      .post(`${base()}/gateways`)
      .set(CSRF)
      .send({ name: 'x', vendor: 'FAKE', credentialRef: 'XYZ' })
      .expect(404);
    const opsList = await ag.network
      .get(`${base()}/network/operations?status=SUCCEEDED`)
      .expect(200);
    expect(opsList.body.data.length).toBeGreaterThan(0);
    await request(h.server).get(`${base()}/network/sessions`).expect(401);
  });
});
