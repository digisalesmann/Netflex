import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { DefaultAdapterRegistry, NetworkEngine } from '@netflex/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_UNAUTH_PATH, fakeController } from '../../lodge-link/src/fake-controller.mjs';
import { createLink, pair } from '../../lodge-link/src/link.mjs';
import { createOmada } from '../../lodge-link/src/omada.mjs';
import {
  CSRF,
  createStaff,
  signInStaff,
  startHarness,
  uniq,
  type Agent,
  type Harness,
} from '../../../scripts/test/api-harness.js';
import { ADAPTER_REGISTRY, NETWORK_ENGINE } from './infra/tokens.js';

let h: Harness;
let base: string;
let owner: Agent;
let P: { id: string; gatewayId: string; planVersionId: string };
const secrets = new Map<string, string>();
const ctrl = fakeController({ version: '5.15.8', site: 'ND Lodge' });
const controllerCfg = {
  url: 'https://127.0.0.1:8043',
  operator: { name: 'netflex-link', password: 'op-pass' },
  openApi: { clientId: 'id', clientSecret: 'secret' },
  paths: { openApiUnauthorize: TEST_UNAUTH_PATH },
};
let token = '';
let running = true;
let loop: Promise<void>;
let link: ReturnType<typeof createLink>;

const omadaCtx = (mac: string) => ({
  gw: P.gatewayId,
  mac: mac.toUpperCase().replace(/:/g, '-'),
  ap: '50-C7-BF-00-00-AA',
  ssid: 'ND Lodge Wi-Fi',
  radio: 1,
  site: 'ND Lodge',
});

/** Carry out every queued network job, as the worker would. */
async function drainNetwork() {
  const engine = h.app.get<NetworkEngine>(NETWORK_ENGINE);
  const events = await h.prisma.outboxEvent.findMany({
    where: { type: { startsWith: 'network.' }, dispatchedAt: null, aggregateId: { not: '' } },
    orderBy: { createdAt: 'asc' },
  });
  const out: string[] = [];
  for (const ev of events) {
    out.push(
      await engine.processCommand(
        ev.id,
        ev.type as Parameters<NetworkEngine['processCommand']>[1],
        ev.payload as { entitlementId?: unknown },
      ),
    );
    await h.prisma.outboxEvent.update({ where: { id: ev.id }, data: { dispatchedAt: new Date() } });
  }
  return out;
}

beforeAll(async () => {
  h = await startHarness({ NETWORK_ADAPTER: 'omada', PAID_ACCESS_ENABLED: 'true' });
  const srv = h.server as unknown as Server;
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  // Only this file's network jobs matter here.
  await h.prisma
    .$executeRaw`UPDATE "outbox_events" SET "dispatchedAt" = now() WHERE "dispatchedAt" IS NULL AND "type" LIKE 'network.%'`;
  owner = await signInStaff(
    h,
    await createStaff(h.prisma, [{ role: 'OWNER', propertyId: null }]),
    secrets,
  );
  const pid = (
    await owner
      .post('/api/v1/admin/properties')
      .set(CSRF)
      .send({ slug: `omada-${uniq()}`, name: 'Omada Lodge' })
  ).body.data.id as string;
  const g = await owner
    .post(`/api/v1/admin/properties/${pid}/gateways`)
    .set(CSRF)
    .send({ name: 'Omada controller', vendor: 'OMADA', model: 'EAP115 ×3' });
  expect(g.status).toBe(201);
  const c = await owner
    .post(`/api/v1/admin/properties/${pid}/plans`)
    .set(CSRF)
    .send({
      slug: 'day',
      version: {
        name: 'Daily',
        description: '24 hours',
        scope: 'INDIVIDUAL',
        price: '400',
        duration: { value: 1, unit: 'DAY' },
        activationPolicy: 'ON_FIRST_REDEMPTION',
        redemptionWindow: { value: 30, unit: 'DAY' },
        maxDevices: 1,
        maxConcurrentSessions: 1,
        downloadKbps: null,
        uploadKbps: null,
        maxGroupMembers: null,
        renewalRule: 'STACK_AFTER_CURRENT_EXPIRY',
        availableFrom: null,
        availableUntil: null,
        fairUseText: null,
        refundPolicyText: 'Refunds before first use.',
        termsVersion: 't',
      },
    });
  await owner
    .post(
      `/api/v1/admin/properties/${pid}/plans/${c.body.data.planId}/versions/${c.body.data.versionId}/publish`,
    )
    .set(CSRF)
    .send({})
    .expect(200);
  P = {
    id: pid,
    gatewayId: g.body.data.id as string,
    planVersionId: c.body.data.versionId as string,
  };
}, 180_000);

afterAll(async () => {
  running = false;
  await loop?.catch(() => null);
  await h.close();
});

async function voucher() {
  const r = await owner
    .post(`/api/v1/admin/properties/${P.id}/vouchers`)
    .set(CSRF)
    .send({
      planVersionId: P.planVersionId,
      issuanceType: 'MANUAL',
      reason: 'omada test',
      target: { scope: 'INDIVIDUAL' },
    });
  return r.body.data.vouchers[0].code as string;
}

describe('Omada through the lodge link', () => {
  it('pairs once with the office code and checks in', async () => {
    const r = await owner
      .post(`/api/v1/admin/properties/${P.id}/gateways/${P.gatewayId}/link-code`)
      .set(CSRF)
      .send({})
      .expect(200);
    const code = r.body.data.code as string;
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const p = await pair(base, code.toLowerCase());
    expect(p.gatewayId).toBe(P.gatewayId);
    token = p.token;
    await expect(pair(base, code)).rejects.toThrow(/wrong or has expired/);
    expect(
      JSON.stringify(await h.prisma.lodgeLink.findUnique({ where: { gatewayId: P.gatewayId } })),
    ).not.toContain(token);

    link = createLink(
      { server: base, token, controller: controllerCfg },
      { omada: createOmada(controllerCfg, { request: ctrl.request }), waitMs: 200, log: () => {} },
    );
    loop = (async () => {
      while (running) await link.once().catch(() => new Promise((r) => setTimeout(r, 100)));
    })();

    const engine = h.app.get<NetworkEngine>(NETWORK_ENGINE);
    await expect
      .poll(async () => (await engine.checkGateway(P.gatewayId)).reachable, { timeout: 10_000 })
      .toBe(true);
    const list = await owner.get(`/api/v1/admin/properties/${P.id}/gateways`).expect(200);
    expect(list.body.data[0]).toMatchObject({
      vendor: 'OMADA',
      status: 'HEALTHY',
      firmware: 'Omada 5.15.8',
      link: {
        paired: true,
        online: true,
        controllerOk: true,
        features: { unauthorize: true, listClients: true },
      },
    });
  });

  it('a phone on the sign-in page enters a code and Omada switches it on until the plan ends', async () => {
    const mac = 'aa:bb:cc:6e:00:01';
    // The phone has to be on the Wi-Fi: the link asks the controller.
    const away = await request(h.server)
      .post('/api/v1/portal/context')
      .set(CSRF)
      .send(omadaCtx(mac));
    expect(away.body.data.gateway).toBe('RECONNECT_REQUIRED');
    ctrl.state.connected.set('AA-BB-CC-6E-00-01', '50-C7-BF-00-00-AA');
    const ctx = await request(h.server)
      .post('/api/v1/portal/context')
      .set(CSRF)
      .send(omadaCtx(mac));
    expect(ctx.body.data).toMatchObject({
      gateway: 'AVAILABLE',
      property: { name: 'Omada Lodge' },
    });

    const code = await voucher();
    const r = await request(h.server)
      .post('/api/v1/portal/redeem')
      .set(CSRF)
      .send({ ...omadaCtx(mac), code });
    expect(r.body.data.state).toBe('ACCESS_BEING_CONFIGURED');
    expect(await drainNetwork()).toContain('SUCCEEDED');

    const a = ctrl.state.authorized.get('AA-BB-CC-6E-00-01');
    expect(a).toMatchObject({
      apMac: '50-C7-BF-00-00-AA',
      ssidName: 'ND Lodge Wi-Fi',
      radioId: '1',
      site: 'ND Lodge',
    });
    // A day, in microseconds (controller 5.x).
    expect(Number(a.time) / 3_600_000_000).toBeCloseTo(24, 0);
    const st = await request(h.server).post('/api/v1/portal/status').set(CSRF).send(omadaCtx(mac));
    expect(st.body.data).toMatchObject({ state: 'CONNECTED', planName: 'Daily' });
  });

  it('revoking switches the device off on the controller', async () => {
    const e = await h.prisma.linkGrant.findFirstOrThrow({ where: { gatewayId: P.gatewayId } });
    const adapter = h.app
      .get<DefaultAdapterRegistry>(ADAPTER_REGISTRY)
      .forGateway(await h.prisma.gateway.findUniqueOrThrow({ where: { id: P.gatewayId } }));
    expect(await adapter?.revokeEntitlement(e.entitlementId)).toEqual({ ok: true });
    expect(ctrl.state.authorized.has('AA-BB-CC-6E-00-01')).toBe(false);
    expect(await adapter?.readEntitlement(e.entitlementId)).toMatchObject({ present: false });
  });

  it('a controller that is down shows as unreachable, and nothing is pretended', async () => {
    ctrl.state.up = false;
    link.recheck();
    const engine = h.app.get<NetworkEngine>(NETWORK_ENGINE);
    await expect
      .poll(async () => (await engine.checkGateway(P.gatewayId)).reachable, { timeout: 10_000 })
      .toBe(false);
    const g = await owner.get(`/api/v1/admin/properties/${P.id}/gateways`).expect(200);
    expect(g.body.data[0].link.detail).toMatch(/unreachable/);
    ctrl.state.up = true;
    link.recheck();
    await expect
      .poll(async () => (await engine.checkGateway(P.gatewayId)).reachable, { timeout: 10_000 })
      .toBe(true);
  });

  it('unpairing in the office locks the old link out', async () => {
    await owner
      .post(`/api/v1/admin/properties/${P.id}/gateways/${P.gatewayId}/link-unpair`)
      .set(CSRF)
      .send({ reason: 'laptop replaced' })
      .expect(200);
    const r = await request(h.server)
      .post('/api/v1/link/poll')
      .set('x-netflex-link', token)
      .send({
        heartbeat: {
          agentVersion: '1.0.0',
          protocol: 1,
          controller: { reachable: true, version: '5.15.8', detail: 'ok' },
          features: { unauthorize: true, listClients: true },
        },
        waitMs: 0,
      });
    expect(r.status).toBe(401);
    const engine = h.app.get<NetworkEngine>(NETWORK_ENGINE);
    expect(await engine.checkGateway(P.gatewayId)).toMatchObject({ reachable: false });
  });
});
