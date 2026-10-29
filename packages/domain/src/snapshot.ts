import { randomInt } from 'node:crypto';
import { DomainError } from './errors.js';
import { isCurrencyCode, money } from './money.js';
import type { PlanVersionSnapshot } from './plans.js';
import { VOUCHER_ALPHABET } from './voucher-code.js';

/** JSON form of a plan version snapshot (money as a decimal string of minor units). */
export interface PlanSnapshotJson extends Omit<
  PlanVersionSnapshot,
  'price' | 'availableFrom' | 'availableUntil'
> {
  price: { amountMinor: string; currency: string };
  availableFrom: string | null;
  availableUntil: string | null;
  schema: 1;
}

export function snapshotToJson(p: PlanVersionSnapshot): PlanSnapshotJson {
  return {
    ...p,
    schema: 1,
    price: { amountMinor: p.price.amountMinor.toString(), currency: p.price.currency },
    availableFrom: p.availableFrom?.toISOString() ?? null,
    availableUntil: p.availableUntil?.toISOString() ?? null,
  };
}

export function snapshotFromJson(j: PlanSnapshotJson): PlanVersionSnapshot {
  if (j.schema !== 1 || !isCurrencyCode(j.price.currency) || !/^\d+$/.test(j.price.amountMinor)) {
    throw new DomainError('PLAN_NOT_PURCHASABLE', 'Unreadable plan snapshot');
  }
  const { schema: _schema, ...rest } = j;
  return {
    ...rest,
    price: money(BigInt(j.price.amountMinor), j.price.currency),
    availableFrom: j.availableFrom ? new Date(j.availableFrom) : null,
    availableUntil: j.availableUntil ? new Date(j.availableUntil) : null,
  };
}

/** Human-friendly order reference, e.g. NFX-7K3M-Q9TD (≈ 39.6 bits; uniqueness enforced by the database). */
export function generateOrderReference(
  rand: (max: number) => number = (m) => randomInt(m),
): string {
  const part = () =>
    Array.from({ length: 4 }, () => VOUCHER_ALPHABET[rand(VOUCHER_ALPHABET.length)]).join('');
  return `NFX-${part()}-${part()}`;
}

/** Canonical lower-case colon MAC, or null if not a MAC. */
export function normalizeMac(input: string): string | null {
  const hex = input
    .trim()
    .toLowerCase()
    .replace(/[:\-.]/g, '');
  if (!/^[0-9a-f]{12}$/.test(hex)) return null;
  return hex.match(/.{2}/g)?.join(':') ?? null;
}

/** Locally administered (randomized/private) MAC — common on modern phones; binding may change per network. */
export function isRandomizedMac(mac: string): boolean {
  const first = parseInt(mac.slice(0, 2), 16);
  return (first & 0b10) === 0b10;
}
