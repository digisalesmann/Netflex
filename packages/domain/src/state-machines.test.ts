import { describe, expect, it } from 'vitest';
import { DomainError } from './errors.js';
import {
  entitlementStateMachine,
  networkOperationStateMachine,
  orderStateMachine,
  paymentStateMachine,
  planStateMachine,
  refundStateMachine,
  voucherStateMachine,
  type StateMachine,
} from './state-machines.js';

describe('payment state machine', () => {
  it('allows the happy path', () => {
    expect(paymentStateMachine.canTransition('CREATED', 'PENDING')).toBe(true);
    expect(paymentStateMachine.canTransition('PENDING', 'SUCCEEDED')).toBe(true);
    expect(paymentStateMachine.canTransition('SUCCEEDED', 'REFUNDED')).toBe(true);
  });

  it('rejects backwards / out-of-order transitions', () => {
    expect(() => paymentStateMachine.assertTransition('SUCCEEDED', 'PENDING')).toThrow(DomainError);
    expect(paymentStateMachine.canTransition('SUCCEEDED', 'FAILED')).toBe(false);
    expect(paymentStateMachine.canTransition('CREATED', 'SUCCEEDED')).toBe(false);
  });

  it('does not auto-apply a late success to a closed payment', () => {
    for (const s of ['FAILED', 'ABANDONED', 'EXPIRED'] as const) {
      expect(paymentStateMachine.canTransition(s, 'SUCCEEDED')).toBe(false);
    }
  });

  it('marks terminal states', () => {
    expect([...paymentStateMachine.terminal].sort()).toEqual([
      'ABANDONED',
      'EXPIRED',
      'FAILED',
      'REFUNDED',
    ]);
  });
});

describe('order state machine', () => {
  it('keeps a paid order paid (only refund leaves PAID)', () => {
    expect(orderStateMachine.nextStates('PAID')).toEqual(['REFUNDED']);
  });
});

describe('voucher state machine', () => {
  it('cannot skip issuance', () => {
    expect(voucherStateMachine.canTransition('GENERATED', 'ACTIVE')).toBe(false);
  });
  it('revoked and expired are terminal', () => {
    expect(voucherStateMachine.nextStates('REVOKED')).toEqual([]);
    expect(voucherStateMachine.nextStates('EXPIRED')).toEqual([]);
  });
  it('can be suspended and reinstated', () => {
    expect(voucherStateMachine.canTransition('ACTIVE', 'SUSPENDED')).toBe(true);
    expect(voucherStateMachine.canTransition('SUSPENDED', 'ACTIVE')).toBe(true);
  });
});

describe('entitlement state machine', () => {
  it('requires provisioning before ACTIVE', () => {
    expect(entitlementStateMachine.canTransition('PENDING_ACTIVATION', 'ACTIVE')).toBe(false);
    expect(entitlementStateMachine.canTransition('PROVISIONING', 'ACTIVE')).toBe(true);
  });
  it('can suspend access that is still being provisioned', () => {
    expect(entitlementStateMachine.canTransition('PROVISIONING', 'SUSPENDED')).toBe(true);
    expect(entitlementStateMachine.canTransition('PROVISIONING_FAILED', 'SUSPENDED')).toBe(true);
  });
  it('allows retry after provisioning failure', () => {
    expect(entitlementStateMachine.canTransition('PROVISIONING_FAILED', 'PROVISIONING')).toBe(true);
  });
  it('cannot resurrect expired or revoked', () => {
    expect(entitlementStateMachine.nextStates('EXPIRED')).toEqual([]);
    expect(entitlementStateMachine.nextStates('REVOKED')).toEqual([]);
  });
});

describe('other machines', () => {
  it('refund needs approval before submission', () => {
    expect(refundStateMachine.canTransition('REQUESTED', 'SUBMITTED')).toBe(false);
    expect(refundStateMachine.canTransition('APPROVED', 'SUBMITTED')).toBe(true);
  });
  it('archived plans are terminal; drafts cannot be paused', () => {
    expect(planStateMachine.nextStates('ARCHIVED')).toEqual([]);
    expect(planStateMachine.canTransition('DRAFT', 'PAUSED')).toBe(false);
  });
  it('failed network ops can only be replayed via PENDING', () => {
    expect(networkOperationStateMachine.nextStates('FAILED')).toEqual(['PENDING']);
  });
  it('every machine only references its own states', () => {
    for (const m of [
      paymentStateMachine,
      orderStateMachine,
      voucherStateMachine,
      entitlementStateMachine,
      refundStateMachine,
      planStateMachine,
      networkOperationStateMachine,
    ] as StateMachine<string>[]) {
      for (const s of m.states) for (const n of m.nextStates(s)) expect(m.states).toContain(n);
    }
  });
});
