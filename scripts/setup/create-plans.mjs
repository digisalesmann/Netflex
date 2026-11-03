#!/usr/bin/env node
// One-time setup of ND Lodge's launch plans, recorded as created by the platform
// owner (run create-owner first). Safe to re-run: skips plans that already exist,
// never edits a published version. Change prices later by publishing a new version.
//   node scripts/setup/create-plans.mjs
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const { createPrismaClient } = require(join(root, 'packages/database/dist/index.js'));

const SLUG = 'nd-lodge';
const COMMON = {
  scope: 'INDIVIDUAL',
  currency: 'NGN',
  durationUnit: 'DAY',
  activationPolicy: 'ON_FIRST_REDEMPTION',
  redemptionWindowValue: 30,
  redemptionWindowUnit: 'DAY',
  maxDevices: 1,
  maxConcurrentSessions: 1,
  downloadKbps: null,
  uploadKbps: null,
  renewalRule: 'STACK_AFTER_CURRENT_EXPIRY',
  fairUseText: 'Shared satellite connection: please avoid very large downloads at busy times.',
  refundPolicyText:
    'Full refund before you first use the code. After that, refunds are decided case by case, for example after a long outage you reported.',
  termsVersion: '2026-11',
};
const PLANS = [
  {
    slug: 'daily',
    name: 'Daily',
    description: 'A full day online.',
    priceMinor: 40000n,
    durationValue: 1,
  },
  {
    slug: 'weekly',
    name: 'Weekly',
    description: 'Seven days online.',
    priceMinor: 250000n,
    durationValue: 7,
  },
  {
    slug: 'monthly',
    name: 'Monthly',
    description: 'Thirty days online.',
    priceMinor: 800000n,
    durationValue: 30,
  },
];

const db = createPrismaClient(process.env.DATABASE_URL ?? '');
try {
  const property = await db.property.findUnique({ where: { slug: SLUG } });
  if (!property) throw new Error(`property ${SLUG} not found: run create-lodge.mjs first`);
  const owner = await db.userRole.findFirst({
    where: {
      revokedAt: null,
      propertyId: null,
      role: { key: 'OWNER' },
      user: { status: 'ACTIVE' },
    },
    orderBy: { createdAt: 'asc' },
    select: { userId: true },
  });
  if (!owner) throw new Error('no active owner: run apps/api/dist/cli/create-owner.js first');

  for (const p of PLANS) {
    if (await db.plan.findFirst({ where: { propertyId: property.id, slug: p.slug } })) {
      console.log(`${p.name}: already exists, skipped`);
      continue;
    }
    await db.$transaction(async (tx) => {
      const plan = await tx.plan.create({
        data: { propertyId: property.id, slug: p.slug, status: 'PUBLISHED' },
      });
      await tx.planVersion.create({
        data: {
          ...COMMON,
          planId: plan.id,
          version: 1,
          name: p.name,
          description: p.description,
          priceMinor: p.priceMinor,
          durationValue: p.durationValue,
          createdById: owner.userId,
          publishedAt: new Date(),
        },
      });
    });
    console.log(`${p.name}: created, ₦${Number(p.priceMinor) / 100} for ${p.durationValue} day(s)`);
  }
} finally {
  await db.$disconnect();
}
