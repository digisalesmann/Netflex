import { describe, expect, it } from 'vitest';
import { money } from './money.js';
import type { PlanVersionSnapshot } from './plans.js';
import {
  generateOrderReference,
  isRandomizedMac,
  normalizeMac,
  snapshotFromJson,
  snapshotToJson,
} from './snapshot.js';

const plan: PlanVersionSnapshot = {
  planId: 'p',
  planVersionId: 'v',
  version: 3,
  propertyId: 'prop',
  name: 'Week',
  status: 'PUBLISHED',
  scope: 'ROOM',
  price: money(999_999_999_999n, 'NGN'),
  duration: { value: 1, unit: 'CALENDAR_MONTH' },
  activationPolicy: 'ON_FIRST_AUTHORIZATION',
  redemptionWindow: { value: 30, unit: 'DAY' },
  maxDevices: 4,
  maxConcurrentSessions: 3,
  rate: { downloadKbps: 10_000, uploadKbps: null },
  maxGroupMembers: 4,
  renewalRule: 'STACK_AFTER_CURRENT_EXPIRY',
  availableFrom: new Date('2026-01-01T00:00:00Z'),
  availableUntil: null,
  termsVersion: 't1',
};

describe('plan snapshot JSON', () => {
  it('round-trips without losing money precision', () => {
    const json = JSON.parse(JSON.stringify(snapshotToJson(plan)));
    expect(json.price).toEqual({ amountMinor: '999999999999', currency: 'NGN' });
    expect(snapshotFromJson(json)).toEqual(plan);
  });
  it('rejects tampered snapshots', () => {
    const json = snapshotToJson(plan);
    expect(() =>
      snapshotFromJson({ ...json, price: { amountMinor: '1.5', currency: 'NGN' } }),
    ).toThrow();
    expect(() =>
      snapshotFromJson({ ...json, price: { amountMinor: '1', currency: 'XYZ' } }),
    ).toThrow();
  });
});

describe('order references', () => {
  it('have the NFX-XXXX-XXXX shape with no confusable characters', () => {
    for (let i = 0; i < 100; i++)
      expect(generateOrderReference()).toMatch(/^NFX-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
  });
});

describe('MAC addresses', () => {
  it.each([
    ['AA-BB-CC-DD-EE-FF', 'aa:bb:cc:dd:ee:ff'],
    ['aabb.ccdd.eeff', 'aa:bb:cc:dd:ee:ff'],
    [' 00:1A:2b:3C:4d:5E ', '00:1a:2b:3c:4d:5e'],
  ])('normalizes %s', (input, out) => expect(normalizeMac(input)).toBe(out));
  it.each(['', 'zz:zz:zz:zz:zz:zz', 'aa:bb:cc', '<script>'])('rejects %j', (bad) =>
    expect(normalizeMac(bad)).toBeNull(),
  );
  it('detects randomized (locally administered) addresses', () => {
    expect(isRandomizedMac('da:a1:19:00:00:01')).toBe(true);
    expect(isRandomizedMac('00:1a:2b:3c:4d:5e')).toBe(false);
  });
});
