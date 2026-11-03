#!/usr/bin/env node
// Adds a fuller DEMO plan catalogue to the local development lodge, so the Plans
// page can be designed and tested at a realistic size. Prices are placeholders,
// not recommendations. Safe to re-run: plans that already exist (by slug) are
// skipped. Development database (netflex_dev) only.
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const { createPrismaClient } = require(join(root, 'packages/database/dist/index.js'));

const url = process.env.DATABASE_URL ?? '';
const slug = process.env.NETFLEX_PROPERTY_SLUG ?? 'demo-lodge';
if (process.env.NETFLEX_ENV !== 'development' || !/\/netflex_dev(\?|$)/.test(url))
  throw new Error('refusing: demo catalogue runs only with NETFLEX_ENV=development on netflex_dev');

const N = (naira) => BigInt(naira * 100);
const CATALOG = [
  // personal
  [
    'hour-pass',
    'Hour pass',
    'An hour online, for quick tasks.',
    'INDIVIDUAL',
    N(150),
    'HOUR',
    1,
    1,
  ],
  [
    'three-hours',
    '3 hours',
    'Three hours for calls and catching up.',
    'INDIVIDUAL',
    N(300),
    'HOUR',
    3,
    1,
  ],
  ['day-pass', 'Day pass', 'A full day online.', 'INDIVIDUAL', N(500), 'DAY', 1, 2],
  ['three-days', '3-day pass', 'Three days, two devices.', 'INDIVIDUAL', N(1300), 'DAY', 3, 2],
  ['week-pass', 'Week pass', 'Seven days, two devices.', 'INDIVIDUAL', N(2500), 'DAY', 7, 2],
  [
    'month-pass',
    'Month pass',
    'A full month, three devices.',
    'INDIVIDUAL',
    N(8000),
    'CALENDAR_MONTH',
    1,
    3,
  ],
  // room
  ['room-day', 'Room day', 'The whole room for a day.', 'ROOM', N(1200), 'DAY', 1, 6, 4],
  ['room-week', 'Room week', 'The whole room for a week.', 'ROOM', N(6000), 'DAY', 7, 6, 4],
  [
    'room-month',
    'Room month',
    'The whole room for a month.',
    'ROOM',
    N(18000),
    'CALENDAR_MONTH',
    1,
    8,
    4,
  ],
  // floor
  [
    'floor-week',
    'Floor week',
    'Every room on your floor for a week.',
    'FLOOR',
    N(20000),
    'DAY',
    7,
    24,
    16,
  ],
  [
    'floor-month',
    'Floor month',
    'Every room on your floor for a month.',
    'FLOOR',
    N(60000),
    'CALENDAR_MONTH',
    1,
    30,
    16,
  ],
];

const db = createPrismaClient(url);
const property = await db.property.findUnique({ where: { slug } });
if (!property) throw new Error(`no property "${slug}": run npm run db:seed:dev first`);
const staff = await db.user.findFirst({ where: { kind: 'STAFF' } });

let added = 0;
for (const [
  planSlug,
  name,
  description,
  scope,
  priceMinor,
  unit,
  value,
  devices,
  members,
] of CATALOG) {
  if (await db.plan.findFirst({ where: { propertyId: property.id, slug: planSlug } })) continue;
  const p = await db.plan.create({
    data: { propertyId: property.id, slug: planSlug, status: 'PUBLISHED' },
  });
  await db.planVersion.create({
    data: {
      planId: p.id,
      version: 1,
      name,
      description,
      scope,
      currency: 'NGN',
      priceMinor,
      durationUnit: unit,
      durationValue: value,
      activationPolicy: 'ON_FIRST_REDEMPTION',
      redemptionWindowValue: 30,
      redemptionWindowUnit: 'DAY',
      renewalRule: 'STACK_AFTER_CURRENT_EXPIRY',
      maxDevices: devices,
      maxConcurrentSessions: devices,
      maxGroupMembers: members ?? null,
      downloadKbps: null,
      uploadKbps: null,
      refundPolicyText: 'Full refund before first use; afterwards at the property’s discretion.',
      termsVersion: '2026-10',
      createdById: staff.id,
      publishedAt: new Date(),
    },
  });
  added++;
}
await db.$disconnect();
console.log(`demo catalogue: added ${added} plan(s); ${CATALOG.length} in the list`);
