import type { Plan, PlanVersion } from '@netflex/database';
import { formatMoney, isCurrencyCode, money, type PlanVersionSnapshot } from '@netflex/domain';

/** Database row → domain snapshot (the single place this mapping lives). */
export function toSnapshot(plan: Plan, v: PlanVersion): PlanVersionSnapshot {
  if (!isCurrencyCode(v.currency)) throw new Error(`unsupported currency ${v.currency}`);
  return {
    planId: plan.id,
    planVersionId: v.id,
    version: v.version,
    propertyId: plan.propertyId,
    name: v.name,
    status: plan.status,
    scope: v.scope,
    price: money(v.priceMinor, v.currency),
    duration: { value: v.durationValue, unit: v.durationUnit },
    activationPolicy: v.activationPolicy,
    redemptionWindow:
      v.redemptionWindowValue && v.redemptionWindowUnit
        ? { value: v.redemptionWindowValue, unit: v.redemptionWindowUnit }
        : null,
    maxDevices: v.maxDevices,
    maxConcurrentSessions: v.maxConcurrentSessions,
    rate: { downloadKbps: v.downloadKbps, uploadKbps: v.uploadKbps },
    maxGroupMembers: v.maxGroupMembers,
    renewalRule: v.renewalRule,
    availableFrom: v.availableFrom,
    availableUntil: v.availableUntil,
    termsVersion: v.termsVersion,
  };
}

/** Public, customer-facing view of a plan version: everything shown before payment (spec §10). */
export function publicPlanView(plan: Plan, v: PlanVersion) {
  const s = toSnapshot(plan, v);
  return {
    planId: plan.id,
    planVersionId: v.id,
    slug: plan.slug,
    name: v.name,
    description: v.description,
    scope: v.scope,
    price: {
      amountMinor: s.price.amountMinor.toString(),
      currency: s.price.currency,
      display: formatMoney(s.price),
    },
    duration: s.duration,
    activationPolicy: v.activationPolicy,
    redemptionWindow: s.redemptionWindow,
    maxDevices: v.maxDevices,
    maxConcurrentSessions: v.maxConcurrentSessions,
    speed: { downloadKbps: v.downloadKbps, uploadKbps: v.uploadKbps, guaranteed: false },
    maxGroupMembers: v.maxGroupMembers,
    renewalRule: v.renewalRule,
    fairUseText: v.fairUseText,
    refundPolicyText: v.refundPolicyText,
    termsVersion: v.termsVersion,
  };
}
