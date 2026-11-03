#!/usr/bin/env node
// Seeds the LOCAL DEVELOPMENT database (netflex_dev only) with a demo property,
// three published plans, a SIMULATED gateway and three demo vouchers, so the
// website and Wi-Fi sign-in page have something to show. Safe to re-run: does
// nothing if the demo property already exists. Never run against real data.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const { createPrismaClient, syncRbac } = require(join(root, 'packages/database/dist/index.js'));
const { grantAccess } = require(join(root, 'packages/core/dist/index.js'));
const { formatVoucherCode, money } = require(join(root, 'packages/domain/dist/index.js'));

const url = process.env.DATABASE_URL ?? '';
const pepper = process.env.VOUCHER_PEPPER ?? '';
const slug = process.env.NETFLEX_PROPERTY_SLUG ?? 'demo-lodge';
if (process.env.NETFLEX_ENV !== 'development' || !/\/netflex_dev(\?|$)/.test(url))
  throw new Error('refusing: dev seed runs only with NETFLEX_ENV=development on netflex_dev');
if (!pepper) throw new Error('VOUCHER_PEPPER is not set');

const db = createPrismaClient(url);
await syncRbac(db);
if (await db.property.findUnique({ where: { slug } })) {
  console.log(`demo property "${slug}" already exists; nothing to do`);
  await db.$disconnect();
  process.exit(0);
}

const property = await db.property.create({
  data: {
    slug,
    name: 'ND Lodge',
    timeZone: 'Africa/Lagos',
    currency: 'NGN',
    supportPhone: '+2347040332279',
    supportEmail: 'networkflex24@gmail.com',
  },
});
const staff = await db.user.create({
  data: { kind: 'STAFF', email: 'dev-owner@test.invalid', displayName: 'Dev Owner' },
});
const building = await db.building.create({ data: { propertyId: property.id, name: 'Main' } });
const floor = await db.floor.create({
  data: { propertyId: property.id, buildingId: building.id, label: 'Ground', level: 0 },
});
for (const label of ['G1', 'G2', 'G3'])
  await db.room.create({ data: { propertyId: property.id, floorId: floor.id, label } });

async function plan(planSlug, v) {
  const p = await db.plan.create({
    data: { propertyId: property.id, slug: planSlug, status: 'PUBLISHED' },
  });
  const pv = await db.planVersion.create({
    data: {
      planId: p.id,
      version: 1,
      currency: 'NGN',
      durationUnit: 'DAY',
      activationPolicy: 'ON_FIRST_REDEMPTION',
      redemptionWindowValue: 30,
      redemptionWindowUnit: 'DAY',
      renewalRule: 'STACK_AFTER_CURRENT_EXPIRY',
      refundPolicyText: 'Full refund before first use; afterwards at the property’s discretion.',
      termsVersion: '2026-10',
      createdById: staff.id,
      publishedAt: new Date(),
      downloadKbps: null,
      uploadKbps: null,
      ...v,
    },
  });
  return { plan: p, version: pv };
}
const day = await plan('day-pass', {
  name: 'Day pass',
  description: 'A full day online.',
  scope: 'INDIVIDUAL',
  priceMinor: 50000n,
  durationValue: 1,
  maxDevices: 2,
  maxConcurrentSessions: 2,
  fairUseText: 'Please avoid very large downloads at peak times.',
});
await plan('week-pass', {
  name: 'Week pass',
  description: 'Seven days, two devices.',
  scope: 'INDIVIDUAL',
  priceMinor: 250000n,
  durationValue: 7,
  maxDevices: 2,
  maxConcurrentSessions: 2,
  downloadKbps: 10000,
  uploadKbps: 3000,
});
await plan('room-week', {
  name: 'Room week',
  description: 'The whole room for a week.',
  scope: 'ROOM',
  priceMinor: 600000n,
  durationValue: 7,
  maxDevices: 6,
  maxConcurrentSessions: 6,
  maxGroupMembers: 4,
});
await db.gateway.create({
  data: {
    propertyId: property.id,
    name: 'Main gateway (simulated)',
    vendor: 'FAKE',
    credentialRef: 'DEV_SIMULATED',
    status: 'HEALTHY',
  },
});

const snapshot = {
  planId: day.plan.id,
  planVersionId: day.version.id,
  version: 1,
  propertyId: property.id,
  name: 'Day pass',
  status: 'PUBLISHED',
  scope: 'INDIVIDUAL',
  price: money(50000n, 'NGN'),
  duration: { value: 1, unit: 'DAY' },
  activationPolicy: 'ON_FIRST_REDEMPTION',
  redemptionWindow: { value: 30, unit: 'DAY' },
  maxDevices: 2,
  maxConcurrentSessions: 2,
  rate: { downloadKbps: null, uploadKbps: null },
  maxGroupMembers: null,
  renewalRule: 'STACK_AFTER_CURRENT_EXPIRY',
  availableFrom: null,
  availableUntil: null,
  termsVersion: '2026-10',
};
const codes = [];
for (let i = 0; i < 3; i++) {
  const g = await db.$transaction((tx) =>
    grantAccess(
      tx,
      { pepper, pepperVersion: Number(process.env.VOUCHER_PEPPER_VERSION ?? 1) },
      {
        propertyId: property.id,
        timeZone: 'Africa/Lagos',
        plan: snapshot,
        target: { scope: 'INDIVIDUAL', userId: null },
        ownerUserId: null,
        orderId: null,
        issuance: { type: 'COMPLIMENTARY', issuedById: staff.id, reason: 'dev seed' },
        now: new Date(),
      },
    ),
  );
  codes.push(formatVoucherCode(g.code));
}
await db.$disconnect();
// Demo voucher codes go only to a git-ignored local file.
mkdirSync(join(root, '.local-data'), { recursive: true });
writeFileSync(join(root, '.local-data/dev-vouchers.json'), JSON.stringify({ codes }, null, 2));
console.log(`seeded "${slug}" with 3 plans and a simulated gateway`);
console.log('demo Day-pass vouchers (dev only):', codes.join('  '));
