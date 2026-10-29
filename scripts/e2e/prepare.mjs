#!/usr/bin/env node
// Prepares an isolated end-to-end database: schema "e2e" inside netflex_test,
// migrated from zero, roles synced, and seeded with a property, plans, a
// SIMULATED gateway and one voucher. Test database only.
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const { createPrismaClient, syncRbac } = require(join(root, 'packages/database/dist/index.js'));
const { grantAccess } = require(join(root, 'packages/core/dist/index.js'));
const { formatVoucherCode, money } = require(join(root, 'packages/domain/dist/index.js'));
const { E2E } = require(join(root, 'e2e/env.cjs'));

const url = E2E.DATABASE_URL;
if (!url.includes('/netflex_test?schema=e2e'))
  throw new Error('refusing: e2e must use netflex_test schema e2e');

const admin = createPrismaClient(url.replace('schema=e2e', 'schema=public'));
await admin.$executeRawUnsafe('DROP SCHEMA IF EXISTS "e2e" CASCADE');
await admin.$disconnect();
execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
  cwd: join(root, 'packages/database'),
  env: { ...process.env, DATABASE_URL: url },
  stdio: 'pipe',
});

const db = createPrismaClient(url);
await syncRbac(db);
const property = await db.property.create({
  data: {
    slug: E2E.NETFLEX_PROPERTY_SLUG,
    name: 'Harbour View Lodge',
    timeZone: 'Africa/Lagos',
    currency: 'NGN',
    supportPhone: '+2348000000100',
    supportEmail: 'help@lodge.test',
  },
});
const staff = await db.user.create({
  data: { kind: 'STAFF', email: 'e2e-owner@test.invalid', displayName: 'E2E Owner' },
});
const building = await db.building.create({ data: { propertyId: property.id, name: 'Main' } });
const floor = await db.floor.create({
  data: { propertyId: property.id, buildingId: building.id, label: 'Ground', level: 0 },
});
const room = await db.room.create({
  data: { propertyId: property.id, floorId: floor.id, label: 'G1' },
});

async function plan(slug, v) {
  const p = await db.plan.create({ data: { propertyId: property.id, slug, status: 'PUBLISHED' } });
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
    credentialRef: 'E2E_SIMULATED',
    status: 'HEALTHY',
  },
});

// Admin-issued vouchers for the tests (codes are written only to a git-ignored local file).
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
      { pepper: E2E.VOUCHER_PEPPER, pepperVersion: 1 },
      {
        propertyId: property.id,
        timeZone: 'Africa/Lagos',
        plan: snapshot,
        target: { scope: 'INDIVIDUAL', userId: null },
        ownerUserId: null,
        orderId: null,
        issuance: { type: 'COMPLIMENTARY', issuedById: staff.id, reason: 'e2e seed' },
        now: new Date(),
      },
    ),
  );
  codes.push(formatVoucherCode(g.code));
}
mkdirSync(join(root, 'e2e/.state'), { recursive: true });
writeFileSync(
  join(root, 'e2e/.state/seed.json'),
  JSON.stringify({ codes, roomId: room.id, propertySlug: property.slug }, null, 2),
);
await db.$disconnect();
// Fresh rate-limit counters and queues for each run (e2e Redis database only).
const { Redis } = require(join(root, 'node_modules/ioredis'));
if (!/\/2$/.test(E2E.REDIS_URL)) throw new Error('refusing: e2e must use Redis database 2');
const redis = new Redis(E2E.REDIS_URL);
await redis.flushdb();
await redis.quit();
console.log('e2e database ready');
