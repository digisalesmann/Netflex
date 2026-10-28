import { DomainError } from './errors.js';

/** A small, explicit state machine: allowed transitions only, everything else rejected. */
export interface StateMachine<S extends string> {
  readonly name: string;
  readonly states: readonly S[];
  readonly terminal: readonly S[];
  canTransition(from: S, to: S): boolean;
  assertTransition(from: S, to: S): void;
  nextStates(from: S): readonly S[];
}

export function defineStateMachine<S extends string>(
  name: string,
  states: readonly S[],
  transitions: { readonly [K in S]: readonly S[] },
): StateMachine<S> {
  const terminal = states.filter((s) => transitions[s].length === 0);
  return {
    name,
    states,
    terminal,
    canTransition: (from, to) => transitions[from].includes(to),
    assertTransition(from, to) {
      if (!transitions[from].includes(to)) {
        throw new DomainError(
          'INVALID_STATE_TRANSITION',
          `${name}: ${from} → ${to} is not allowed`,
          {
            machine: name,
            from,
            to,
          },
        );
      }
    },
    nextStates: (from) => transitions[from],
  };
}

// ---------------------------------------------------------------- Payment
export const PAYMENT_STATUSES = [
  'CREATED',
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'ABANDONED',
  'EXPIRED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * A late provider "success" for FAILED/ABANDONED/EXPIRED is deliberately NOT a
 * transition: it is raised as a reconciliation discrepancy for an operator.
 */
export const paymentStateMachine = defineStateMachine<PaymentStatus>('Payment', PAYMENT_STATUSES, {
  CREATED: ['PENDING', 'EXPIRED', 'FAILED'],
  PENDING: ['SUCCEEDED', 'FAILED', 'ABANDONED', 'EXPIRED'],
  SUCCEEDED: ['PARTIALLY_REFUNDED', 'REFUNDED'],
  PARTIALLY_REFUNDED: ['PARTIALLY_REFUNDED', 'REFUNDED'],
  FAILED: [],
  ABANDONED: [],
  EXPIRED: [],
  REFUNDED: [],
});

// ---------------------------------------------------------------- Order
export const ORDER_STATUSES = [
  'CREATED',
  'AWAITING_PAYMENT',
  'PAID',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
  'REFUNDED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const orderStateMachine = defineStateMachine<OrderStatus>('Order', ORDER_STATUSES, {
  CREATED: ['AWAITING_PAYMENT', 'CANCELLED', 'EXPIRED'],
  AWAITING_PAYMENT: ['PAID', 'FAILED', 'EXPIRED', 'CANCELLED'],
  // A paid order stays paid even if provisioning fails (spec §13.4).
  PAID: ['REFUNDED'],
  FAILED: [],
  EXPIRED: [],
  CANCELLED: [],
  REFUNDED: [],
});

// ---------------------------------------------------------------- Voucher
export const VOUCHER_STATUSES = [
  'GENERATED',
  'ISSUED',
  'ACTIVE',
  'EXHAUSTED',
  'EXPIRED',
  'SUSPENDED',
  'REVOKED',
] as const;
export type VoucherStatus = (typeof VOUCHER_STATUSES)[number];

/**
 * ACTIVE = voucher activated (first redemption). Individual device redemptions are
 * separate VoucherRedemption records. EXHAUSTED blocks new devices only.
 * SUSPENDED returns to ISSUED or ACTIVE depending on whether it was ever redeemed;
 * the service enforces which one using redemption history.
 */
export const voucherStateMachine = defineStateMachine<VoucherStatus>('Voucher', VOUCHER_STATUSES, {
  GENERATED: ['ISSUED', 'REVOKED'],
  ISSUED: ['ACTIVE', 'EXPIRED', 'SUSPENDED', 'REVOKED'],
  ACTIVE: ['EXHAUSTED', 'EXPIRED', 'SUSPENDED', 'REVOKED'],
  EXHAUSTED: ['ACTIVE', 'EXPIRED', 'SUSPENDED', 'REVOKED'],
  SUSPENDED: ['ISSUED', 'ACTIVE', 'REVOKED', 'EXPIRED'],
  EXPIRED: [],
  REVOKED: [],
});

// ---------------------------------------------------------------- Entitlement
export const ENTITLEMENT_STATUSES = [
  'PENDING_ACTIVATION',
  'PROVISIONING',
  'ACTIVE',
  'PROVISIONING_FAILED',
  'SUSPENDED',
  'EXPIRED',
  'REVOKED',
] as const;
export type EntitlementStatus = (typeof ENTITLEMENT_STATUSES)[number];

export const entitlementStateMachine = defineStateMachine<EntitlementStatus>(
  'Entitlement',
  ENTITLEMENT_STATUSES,
  {
    PENDING_ACTIVATION: ['PROVISIONING', 'EXPIRED', 'REVOKED', 'SUSPENDED'],
    PROVISIONING: ['ACTIVE', 'PROVISIONING_FAILED', 'REVOKED', 'EXPIRED'],
    PROVISIONING_FAILED: ['PROVISIONING', 'REVOKED', 'EXPIRED'],
    ACTIVE: ['SUSPENDED', 'EXPIRED', 'REVOKED', 'PROVISIONING'],
    SUSPENDED: ['PROVISIONING', 'EXPIRED', 'REVOKED'],
    EXPIRED: [],
    REVOKED: [],
  },
);

// ---------------------------------------------------------------- Refund
export const REFUND_STATUSES = [
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'SUBMITTED',
  'SUCCEEDED',
  'FAILED',
] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const refundStateMachine = defineStateMachine<RefundStatus>('Refund', REFUND_STATUSES, {
  REQUESTED: ['APPROVED', 'REJECTED'],
  APPROVED: ['SUBMITTED'],
  SUBMITTED: ['SUCCEEDED', 'FAILED'],
  FAILED: ['SUBMITTED'],
  REJECTED: [],
  SUCCEEDED: [],
});

// ---------------------------------------------------------------- Plan version
export const PLAN_STATUSES = ['DRAFT', 'PUBLISHED', 'PAUSED', 'ARCHIVED'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const planStateMachine = defineStateMachine<PlanStatus>('Plan', PLAN_STATUSES, {
  DRAFT: ['PUBLISHED', 'ARCHIVED'],
  PUBLISHED: ['PAUSED', 'ARCHIVED'],
  PAUSED: ['PUBLISHED', 'ARCHIVED'],
  ARCHIVED: [],
});

// ---------------------------------------------------------------- Network operation
export const NETWORK_OPERATION_STATUSES = [
  'PENDING',
  'IN_PROGRESS',
  'SUCCEEDED',
  'RETRY_SCHEDULED',
  'FAILED',
  'CANCELLED',
] as const;
export type NetworkOperationStatus = (typeof NETWORK_OPERATION_STATUSES)[number];

export const networkOperationStateMachine = defineStateMachine<NetworkOperationStatus>(
  'NetworkOperation',
  NETWORK_OPERATION_STATUSES,
  {
    PENDING: ['IN_PROGRESS', 'CANCELLED'],
    IN_PROGRESS: ['SUCCEEDED', 'RETRY_SCHEDULED', 'FAILED'],
    RETRY_SCHEDULED: ['IN_PROGRESS', 'CANCELLED', 'FAILED'],
    // Manual, authorized replay moves a failed op back to PENDING.
    FAILED: ['PENDING'],
    SUCCEEDED: [],
    CANCELLED: [],
  },
);
