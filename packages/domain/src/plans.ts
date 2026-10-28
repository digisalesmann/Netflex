import { DomainError } from './errors.js';
import { assertPositive, type Money } from './money.js';
import type { AccessScope } from './scope.js';
import type { PlanStatus } from './state-machines.js';
import {
  assertValidDuration,
  type ActivationPolicy,
  type PlanDuration,
  type RenewalRule,
} from './time.js';

export interface RatePolicy {
  /** Kilobits per second, as seen by the client. Null = no shaping. */
  readonly downloadKbps: number | null;
  readonly uploadKbps: number | null;
}

/**
 * Immutable plan version snapshot. Orders and subscriptions copy this; editing a
 * plan creates a new version and never changes paid terms.
 */
export interface PlanVersionSnapshot {
  readonly planId: string;
  readonly planVersionId: string;
  readonly version: number;
  readonly propertyId: string;
  readonly name: string;
  readonly status: PlanStatus;
  readonly scope: AccessScope;
  readonly price: Money;
  readonly duration: PlanDuration;
  readonly activationPolicy: ActivationPolicy;
  /** Max time between issue and first activation; null = no deadline. */
  readonly redemptionWindow: PlanDuration | null;
  readonly maxDevices: number;
  readonly maxConcurrentSessions: number;
  readonly rate: RatePolicy;
  /** For ROOM/FLOOR: max explicit group members. Null for INDIVIDUAL. */
  readonly maxGroupMembers: number | null;
  readonly renewalRule: RenewalRule;
  readonly availableFrom: Date | null;
  readonly availableUntil: Date | null;
  readonly termsVersion: string;
}

export function validatePlanVersion(p: PlanVersionSnapshot): void {
  assertPositive(p.price);
  assertValidDuration(p.duration);
  if (p.redemptionWindow) assertValidDuration(p.redemptionWindow);
  const intIn = (n: number, min: number, max: number) =>
    Number.isInteger(n) && n >= min && n <= max;
  if (!intIn(p.maxDevices, 1, 500)) throw invalid('maxDevices must be 1–500');
  if (!intIn(p.maxConcurrentSessions, 1, p.maxDevices))
    throw invalid('maxConcurrentSessions must be between 1 and maxDevices');
  for (const v of [p.rate.downloadKbps, p.rate.uploadKbps]) {
    if (v !== null && !intIn(v, 64, 10_000_000))
      throw invalid('rate limits must be 64 kbps – 10 Gbps');
  }
  if (p.scope === 'INDIVIDUAL' && p.maxGroupMembers !== null)
    throw invalid('individual plans cannot have group members');
  if (p.scope !== 'INDIVIDUAL' && (p.maxGroupMembers === null || !intIn(p.maxGroupMembers, 1, 500)))
    throw invalid('room/floor plans need maxGroupMembers 1–500');
  if (p.availableFrom && p.availableUntil && p.availableFrom >= p.availableUntil)
    throw invalid('availableFrom must be before availableUntil');
}

function invalid(msg: string): DomainError {
  return new DomainError('PLAN_NOT_PURCHASABLE', `Invalid plan: ${msg}`);
}

export type PurchaseBlockReason =
  | 'PAID_ACCESS_DISABLED'
  | 'NOT_PUBLISHED'
  | 'WRONG_PROPERTY'
  | 'WRONG_SCOPE'
  | 'NOT_YET_AVAILABLE'
  | 'NO_LONGER_AVAILABLE';

/** Server-side eligibility. The browser never decides price or availability. */
export function checkPurchasable(
  plan: PlanVersionSnapshot,
  ctx: { now: Date; propertyId: string; scope: AccessScope; paidAccessEnabled: boolean },
): { ok: true } | { ok: false; reason: PurchaseBlockReason } {
  if (!ctx.paidAccessEnabled) return { ok: false, reason: 'PAID_ACCESS_DISABLED' };
  if (plan.status !== 'PUBLISHED') return { ok: false, reason: 'NOT_PUBLISHED' };
  if (plan.propertyId !== ctx.propertyId) return { ok: false, reason: 'WRONG_PROPERTY' };
  if (plan.scope !== ctx.scope) return { ok: false, reason: 'WRONG_SCOPE' };
  if (plan.availableFrom && ctx.now < plan.availableFrom)
    return { ok: false, reason: 'NOT_YET_AVAILABLE' };
  if (plan.availableUntil && ctx.now >= plan.availableUntil)
    return { ok: false, reason: 'NO_LONGER_AVAILABLE' };
  return { ok: true };
}
