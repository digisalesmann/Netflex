import type { Prisma, PrismaClient } from '@netflex/database';
import {
  matchVerifiedTransaction,
  money,
  paymentStateMachine,
  refundStateMachine,
  snapshotFromJson,
  orderStateMachine,
  isCurrencyCode,
  type OrderStatus,
  type PaymentStatus,
  type PlanSnapshotJson,
  type PlanVersionSnapshot,
  computeRenewalWindow,
} from '@netflex/domain';
import {
  PaymentProviderError,
  type PaymentProvider,
  type VerifiedTransaction,
} from '@netflex/payments';
import { deriveKey, encryptSecret } from '@netflex/security';
import { grantAccess, type VoucherKeys } from './access.js';
import { lockEntitlement, queueNetwork } from './entitlements.js';
import { recordAudit, type Tx } from './audit.js';

export interface PaymentEngineKeys {
  voucher: VoucherKeys;
  /** AES-256-GCM key for VoucherDelivery.codeEnc. */
  deliveryKey: Buffer;
}

/** Key for encrypting voucher deliveries, derived from VOUCHER_PEPPER (same in API and worker). */
export function deriveDeliveryKey(voucherPepper: string): Buffer {
  return deriveKey(voucherPepper, 'voucher-delivery');
}

export const DELIVERY_WINDOW_MS = 72 * 3600_000;
/** Pending payments older than this are verified by reconciliation even without a webhook. */
export const RECONCILE_AFTER_MS = 5 * 60_000;
/** Pending payments older than this that the provider still reports as unpaid are closed as EXPIRED. */
export const PENDING_GIVE_UP_MS = 48 * 3600_000;

export type SettleOutcome =
  | 'SUCCEEDED_FULFILLED'
  | 'SUCCEEDED_DISCREPANCY'
  | 'FAILED'
  | 'ABANDONED'
  | 'EXPIRED'
  | 'MISMATCH'
  | 'STILL_PENDING'
  | 'ALREADY_FINAL'
  | 'NOT_FOUND';

const OPEN: PaymentStatus[] = ['CREATED', 'PENDING'];
const CLOSED_UNPAID: PaymentStatus[] = ['FAILED', 'ABANDONED', 'EXPIRED'];

/**
 * Payment settlement, webhook processing, reconciliation and refunds (spec §13).
 * Payment state is decided ONLY from a server-side provider verification; webhook
 * bodies and browser redirects merely trigger a check. All state changes go
 * through the state machines under a row lock, so duplicate or out-of-order
 * events are harmless.
 */
export class PaymentEngine {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly provider: PaymentProvider,
    private readonly keys: PaymentEngineKeys,
  ) {}

  // ================================================================ settlement

  async settle(paymentId: string, trigger: string): Promise<SettleOutcome> {
    const p = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!p) return 'NOT_FOUND';
    // Closed-unpaid payments are re-checked only when a webhook or staff asks:
    // a late success must surface as a discrepancy, never be ignored.
    const recheckClosed =
      CLOSED_UNPAID.includes(p.status) &&
      (trigger.startsWith('webhook') || trigger.startsWith('admin'));
    if (!OPEN.includes(p.status) && !recheckClosed) return 'ALREADY_FINAL';

    let verified: VerifiedTransaction | null = null;
    try {
      verified = await this.provider.verify(p.providerReference);
    } catch (e) {
      if (!(e instanceof PaymentProviderError) || e.code !== 'NOT_FOUND') throw e;
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "payments" WHERE "id" = ${paymentId}::uuid FOR UPDATE`;
      const pay = await tx.payment.findUniqueOrThrow({
        where: { id: paymentId },
        include: { order: true },
      });
      if (CLOSED_UNPAID.includes(pay.status)) {
        if (!recheckClosed || verified?.status !== 'success') return 'ALREADY_FINAL';
        const known = await tx.reconciliationDiscrepancy.findFirst({
          where: { paymentId: pay.id, kind: 'LATE_SUCCESS_ON_CLOSED_PAYMENT', resolvedAt: null },
        });
        if (!known) {
          await this.discrepancy(
            tx,
            'LATE_SUCCESS_ON_CLOSED_PAYMENT',
            pay.order.propertyId,
            pay.id,
            null,
            {
              paymentStatus: pay.status,
              orderId: pay.orderId,
              providerAmountMinor: verified.amountMinor.toString(),
              providerCurrency: verified.currency,
              note: 'provider reports success for a payment NetFlex had closed: refund or fulfil manually',
            },
          );
        }
        return 'SUCCEEDED_DISCREPANCY';
      }
      if (!OPEN.includes(pay.status)) return 'ALREADY_FINAL';
      const age = Date.now() - pay.createdAt.getTime();

      if (!verified) {
        // Provider has no record: initialization never completed. Close it after an hour.
        if (age > 3600_000) {
          await this.setPaymentStatus(tx, pay.id, pay.status, 'FAILED', {
            failureCode: 'NOT_FOUND_AT_PROVIDER',
          });
          await this.audit(tx, pay.order.propertyId, 'payment.failed', pay.id, {
            trigger,
            reason: 'not_found_at_provider',
          });
          return 'FAILED';
        }
        return 'NOT_FOUND';
      }

      if (verified.status === 'success') {
        const match = matchVerifiedTransaction(
          {
            reference: pay.providerReference,
            amount: this.money(pay.amountMinor, pay.currency),
            accountId: null,
          },
          { ...verified, accountId: null },
        );
        if (!match.ok) {
          // Money may have moved but not as agreed: never fulfil; an operator decides (refund).
          await this.setPaymentStatus(tx, pay.id, pay.status, 'FAILED', {
            failureCode: `MISMATCH:${match.mismatches.join(',')}`.slice(0, 64),
          });
          await this.discrepancy(
            tx,
            'PAYMENT_AMOUNT_MISMATCH',
            pay.order.propertyId,
            pay.id,
            null,
            {
              expected: {
                reference: pay.providerReference,
                amountMinor: pay.amountMinor.toString(),
                currency: pay.currency,
              },
              actual: {
                reference: verified.reference,
                amountMinor: verified.amountMinor.toString(),
                currency: verified.currency,
                status: verified.rawStatus,
              },
              mismatches: match.mismatches,
            },
          );
          await this.audit(tx, pay.order.propertyId, 'payment.mismatch', pay.id, {
            trigger,
            mismatches: match.mismatches,
          });
          return 'MISMATCH';
        }

        await this.setPaymentStatus(tx, pay.id, pay.status, 'SUCCEEDED', {
          verifiedAt: new Date(),
          providerTransactionId: verified.providerTransactionId,
        });
        await this.audit(tx, pay.order.propertyId, 'payment.succeeded', pay.id, {
          trigger,
          orderId: pay.orderId,
          amountMinor: pay.amountMinor.toString(),
          currency: pay.currency,
        });

        const order = pay.order;
        if (order.status === 'CREATED' || order.status === 'AWAITING_PAYMENT') {
          await this.setOrderStatus(tx, order.id, order.status, 'PAID', { paidAt: new Date() });
          await this.fulfil(tx, order.id);
          return 'SUCCEEDED_FULFILLED';
        }
        // Paid twice, or paid after the order closed: record the money, don't fulfil again.
        await this.discrepancy(
          tx,
          order.status === 'PAID' ? 'PAYMENT_STATE_MISMATCH' : 'LATE_SUCCESS_ON_CLOSED_PAYMENT',
          order.propertyId,
          pay.id,
          null,
          {
            orderId: order.id,
            orderStatus: order.status,
            note:
              order.status === 'PAID'
                ? 'duplicate charge for an already paid order: refund required'
                : 'payment succeeded after the order closed: refund or fulfil manually',
          },
        );
        return 'SUCCEEDED_DISCREPANCY';
      }

      if (verified.status === 'failed' || verified.status === 'abandoned') {
        const to: PaymentStatus = verified.status === 'failed' ? 'FAILED' : 'ABANDONED';
        await this.setPaymentStatus(tx, pay.id, pay.status, to, {
          failureCode: verified.rawStatus.slice(0, 64),
        });
        await this.audit(tx, pay.order.propertyId, `payment.${to.toLowerCase()}`, pay.id, {
          trigger,
        });
        return to as 'FAILED' | 'ABANDONED';
      }

      if (verified.status === 'reversed') {
        await this.discrepancy(tx, 'PAYMENT_STATE_MISMATCH', pay.order.propertyId, pay.id, null, {
          providerStatus: verified.rawStatus,
          note: 'provider reports reversal of an unsettled payment',
        });
        return 'STILL_PENDING';
      }

      // Still pending (or an unrecognized status): give up only after a long time.
      if (age > PENDING_GIVE_UP_MS) {
        await this.setPaymentStatus(tx, pay.id, pay.status, 'EXPIRED', {
          failureCode: `TIMED_OUT:${verified.rawStatus}`.slice(0, 64),
        });
        await this.audit(tx, pay.order.propertyId, 'payment.expired', pay.id, {
          trigger,
          providerStatus: verified.rawStatus,
        });
        return 'EXPIRED';
      }
      return 'STILL_PENDING';
    });
  }

  /**
   * Explicit renewal (spec §9): extend the existing entitlement by the plan's
   * renewal rule, never shortening it. Same voucher and devices keep working.
   * Returns false if the entitlement ended meanwhile; the caller then issues
   * fresh access so the customer still receives what they paid for.
   */
  private async renew(
    tx: Tx,
    order: {
      id: string;
      propertyId: string;
      renewsEntitlementId: string | null;
      customerUserId: string | null;
      planVersionId: string;
      planSnapshot: unknown;
      property: { timeZone: string };
    },
    plan: PlanVersionSnapshot,
  ): Promise<boolean> {
    const e = await lockEntitlement(tx, order.renewsEntitlementId as string, order.propertyId);
    const renewable =
      e &&
      e.expiresAt &&
      ['ACTIVE', 'SUSPENDED', 'PROVISIONING', 'PROVISIONING_FAILED'].includes(e.status) &&
      e.expiresAt > new Date();
    if (!e || !renewable || !e.expiresAt) {
      await this.audit(tx, order.propertyId, 'order.renewal_fell_back', order.id, {
        entitlementId: order.renewsEntitlementId,
        status: e?.status ?? null,
      });
      return false;
    }
    const w = computeRenewalWindow({
      now: new Date(),
      currentExpiresAt: e.expiresAt,
      duration: plan.duration,
      timeZone: order.property.timeZone,
      rule: plan.renewalRule,
    });
    const newExpiry = w.expiresAt > e.expiresAt ? w.expiresAt : e.expiresAt;
    // Linear renewal chain: attach to the latest subscription for this entitlement.
    let tail = e.subscriptionId;
    for (;;) {
      const next = await tx.subscription.findUnique({
        where: { renewsId: tail },
        select: { id: true },
      });
      if (!next) break;
      tail = next.id;
    }
    const sub = await tx.subscription.create({
      data: {
        propertyId: order.propertyId,
        orderId: order.id,
        planVersionId: order.planVersionId,
        planSnapshot: order.planSnapshot as Prisma.InputJsonValue,
        scope: plan.scope,
        ownerUserId: order.customerUserId,
        targetUserId: e.targetUserId,
        targetRoomId: e.targetRoomId,
        targetFloorId: e.targetFloorId,
        activationPolicy: plan.activationPolicy,
        status: 'ACTIVE',
        renewsId: tail,
      },
    });
    await tx.entitlement.update({ where: { id: e.id }, data: { expiresAt: newExpiry } });
    if (e.desiredNetworkState === 'ACTIVE')
      await queueNetwork(tx, 'network.apply_policy', e.id, { reason: 'renewed' });
    await this.audit(tx, order.propertyId, 'order.renewed', order.id, {
      entitlementId: e.id,
      subscriptionId: sub.id,
      rule: plan.renewalRule,
      from: e.expiresAt.toISOString(),
      to: newExpiry.toISOString(),
    });
    return true;
  }

  /** Issue the paid access (subscription + entitlement + voucher) for a PAID order. Exactly once per order. */
  private async fulfil(tx: Tx, orderId: string): Promise<void> {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { property: { select: { timeZone: true } } },
    });
    if (await tx.subscription.findUnique({ where: { orderId } })) return;
    const plan = snapshotFromJson(order.planSnapshot as unknown as PlanSnapshotJson);
    if (order.renewsEntitlementId && (await this.renew(tx, order, plan))) return;
    const target =
      order.scope === 'ROOM'
        ? { scope: 'ROOM' as const, roomId: order.targetRoomId as string }
        : order.scope === 'FLOOR'
          ? { scope: 'FLOOR' as const, floorId: order.targetFloorId as string }
          : { scope: 'INDIVIDUAL' as const, userId: order.targetUserId };
    const now = new Date();
    const g = await grantAccess(tx, this.keys.voucher, {
      propertyId: order.propertyId,
      timeZone: order.property.timeZone,
      plan,
      target: target as never,
      ownerUserId: order.customerUserId,
      orderId: order.id,
      issuance: { type: 'PAID', issuedById: null, reason: null },
      now,
    });
    // The buyer manages a room/floor group they paid for (members are added in the tenant portal).
    if (order.scope !== 'INDIVIDUAL' && order.customerUserId) {
      await tx.groupMembership.create({
        data: {
          subscriptionId: g.subscriptionId,
          userId: order.customerUserId,
          role: 'MANAGER',
          addedById: order.customerUserId,
        },
      });
    }
    await tx.voucherDelivery.create({
      data: {
        voucherId: g.voucherId,
        orderId: order.id,
        codeEnc: encryptSecret(this.keys.deliveryKey, g.code),
        expiresAt: new Date(now.getTime() + DELIVERY_WINDOW_MS),
      },
    });
    await tx.outboxEvent.create({
      data: {
        type: 'notification.voucher_ready',
        aggregateType: 'order',
        aggregateId: order.id,
        payload: { orderId: order.id, voucherId: g.voucherId },
      },
    });
    await this.audit(tx, order.propertyId, 'order.fulfilled', order.id, {
      subscriptionId: g.subscriptionId,
      voucherId: g.voucherId,
      hint: g.hint,
    });
  }

  // ================================================================ webhooks

  async processWebhookEvent(
    eventId: string,
  ): Promise<'PROCESSED' | 'IGNORED' | 'ALREADY_PROCESSED' | 'UNKNOWN_REFERENCE'> {
    const ev = await this.prisma.paymentEvent.findUnique({ where: { id: eventId } });
    if (!ev) return 'IGNORED';
    if (ev.processedAt) return 'ALREADY_PROCESSED';
    const data = ((ev.payloadRedacted as { data?: Record<string, unknown> }).data ?? {}) as Record<
      string,
      unknown
    >;
    let result: 'PROCESSED' | 'IGNORED' | 'UNKNOWN_REFERENCE' = 'IGNORED';

    if (ev.eventType === 'charge.success' || ev.eventType === 'charge.failed') {
      const pay =
        typeof data.reference === 'string'
          ? await this.prisma.payment.findFirst({ where: { providerReference: data.reference } })
          : null;
      if (!pay) result = 'UNKNOWN_REFERENCE';
      else {
        await this.settle(pay.id, `webhook:${ev.eventType}`);
        result = 'PROCESSED';
      }
    } else if (ev.eventType.startsWith('refund.')) {
      const ref = data.transaction_reference;
      const refunds =
        typeof ref === 'string'
          ? await this.prisma.refund.findMany({
              where: { status: 'SUBMITTED', payment: { providerReference: ref } },
              select: { id: true },
            })
          : [];
      for (const r of refunds) await this.checkRefund(r.id);
      result = refunds.length ? 'PROCESSED' : 'UNKNOWN_REFERENCE';
    }

    await this.prisma.paymentEvent.update({
      where: { id: ev.id },
      data: { processedAt: new Date(), processingError: result === 'PROCESSED' ? null : result },
    });
    return result;
  }

  // ================================================================ refunds

  /**
   * Submit an APPROVED refund to the provider. The refund is marked SUBMITTED
   * BEFORE the provider call, so a crash can never cause a second submission;
   * an unknown outcome becomes a discrepancy for a human to check.
   */
  async submitRefund(
    refundId: string,
  ): Promise<'SUBMITTED' | 'SUCCEEDED' | 'FAILED' | 'NEEDS_REVIEW' | 'SKIPPED'> {
    const claimed = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "refunds" WHERE "id" = ${refundId}::uuid FOR UPDATE`;
      const r = await tx.refund.findUnique({
        where: { id: refundId },
        include: { payment: { include: { order: true } } },
      });
      if (!r) return null;
      if (r.status === 'SUBMITTED' && !r.providerRefundId) {
        await this.discrepancy(
          tx,
          'PAYMENT_STATE_MISMATCH',
          r.payment.order.propertyId,
          r.paymentId,
          null,
          {
            refundId: r.id,
            note: 'refund submission outcome unknown (interrupted): check the provider dashboard before any retry',
          },
        );
        return 'NEEDS_REVIEW' as const;
      }
      if (r.status !== 'APPROVED') return 'SKIPPED' as const;
      refundStateMachine.assertTransition('APPROVED', 'SUBMITTED');
      await tx.refund.update({ where: { id: r.id }, data: { status: 'SUBMITTED' } });
      return r;
    });
    if (claimed === null) return 'SKIPPED';
    if (typeof claimed === 'string') return claimed;
    const r = claimed;

    let res;
    try {
      res = await this.provider.createRefund({
        transactionReference: r.payment.providerReference,
        amountMinor: r.amountMinor,
        currency: r.currency,
        merchantNote: `NetFlex refund ${r.id}`,
      });
    } catch (e) {
      const definite =
        e instanceof PaymentProviderError &&
        (e.code === 'REJECTED' || e.code === 'UNAUTHORIZED' || e.code === 'NOT_FOUND');
      await this.prisma.$transaction(async (tx) => {
        if (definite) {
          await tx.refund.update({ where: { id: r.id }, data: { status: 'FAILED' } });
          await this.audit(tx, r.payment.order.propertyId, 'refund.failed', r.id, {
            reason: (e as Error).message.slice(0, 200),
          });
        } else {
          // Timeout/unavailable: the provider may or may not have accepted it. Leave SUBMITTED without id → NEEDS_REVIEW.
          await this.discrepancy(
            tx,
            'PAYMENT_STATE_MISMATCH',
            r.payment.order.propertyId,
            r.paymentId,
            null,
            {
              refundId: r.id,
              note: 'provider did not confirm refund submission: verify on the provider dashboard',
            },
          );
        }
      });
      return definite ? 'FAILED' : 'NEEDS_REVIEW';
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.refund.update({
        where: { id: r.id },
        data: { providerRefundId: res.providerRefundId },
      });
      await this.audit(tx, r.payment.order.propertyId, 'refund.submitted', r.id, {
        providerRefundId: res.providerRefundId,
      });
    });
    if (res.status === 'processed' || res.status === 'failed')
      return (await this.checkRefund(r.id)) as 'SUCCEEDED' | 'FAILED';
    return 'SUBMITTED';
  }

  /** Confirm a SUBMITTED refund's outcome with the provider and apply its financial effects once. */
  async checkRefund(refundId: string): Promise<'SUCCEEDED' | 'FAILED' | 'PENDING' | 'SKIPPED'> {
    const r0 = await this.prisma.refund.findUnique({ where: { id: refundId } });
    if (!r0 || r0.status !== 'SUBMITTED' || !r0.providerRefundId) return 'SKIPPED';
    const res = await this.provider.fetchRefund(r0.providerRefundId);
    if (res.status !== 'processed' && res.status !== 'failed') return 'PENDING';

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "payments" WHERE "id" = ${r0.paymentId}::uuid FOR UPDATE`;
      const r = await tx.refund.findUniqueOrThrow({
        where: { id: refundId },
        include: { payment: { include: { order: true } } },
      });
      if (r.status !== 'SUBMITTED') return 'SKIPPED';
      const propertyId = r.payment.order.propertyId;

      if (res.status === 'failed') {
        await tx.refund.update({ where: { id: r.id }, data: { status: 'FAILED' } });
        await this.audit(tx, propertyId, 'refund.failed', r.id, { providerStatus: res.status });
        return 'FAILED';
      }
      if (res.amountMinor !== r.amountMinor || res.currency !== r.currency) {
        await this.discrepancy(tx, 'PAYMENT_AMOUNT_MISMATCH', propertyId, r.paymentId, null, {
          refundId: r.id,
          expected: { amountMinor: r.amountMinor.toString(), currency: r.currency },
          actual: { amountMinor: res.amountMinor.toString(), currency: res.currency },
        });
      }
      await tx.refund.update({
        where: { id: r.id },
        data: { status: 'SUCCEEDED', completedAt: new Date() },
      });
      const refunded = r.payment.refundedMinor + r.amountMinor;
      const full = refunded >= r.payment.amountMinor;
      await this.setPaymentStatus(
        tx,
        r.paymentId,
        r.payment.status,
        full ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
        { refundedMinor: refunded },
      );
      if (full && r.payment.order.status === 'PAID') {
        await this.setOrderStatus(tx, r.payment.orderId, 'PAID', 'REFUNDED', {});
        // Never-used paid access is withdrawn; access already in use is left to an operator decision (spec §13.5).
        const unused = await tx.voucher.findMany({
          where: { orderId: r.payment.orderId, status: 'ISSUED' },
        });
        for (const v of unused) {
          await tx.voucher.update({
            where: { id: v.id },
            data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: 'order refunded' },
          });
          await tx.voucherDelivery.deleteMany({ where: { voucherId: v.id } });
        }
        const inUse = await tx.voucher.count({
          where: { orderId: r.payment.orderId, status: { in: ['ACTIVE', 'EXHAUSTED'] } },
        });
        await this.audit(tx, propertyId, 'order.refunded', r.payment.orderId, {
          refundId: r.id,
          unusedVouchersRevoked: unused.length,
          vouchersInUseUnchanged: inUse,
        });
      }
      await this.audit(tx, propertyId, 'refund.succeeded', r.id, {
        amountMinor: r.amountMinor.toString(),
        full,
      });
      return 'SUCCEEDED';
    });
  }

  // ================================================================ reconciliation

  /**
   * Periodic reconciliation (spec §23): verify stale pending payments with the
   * provider, expire unpaid orders, re-check submitted refunds, detect paid orders
   * without access, and purge expired voucher deliveries. One failing item never
   * stops the rest; nothing financial is rewritten without provider evidence.
   */
  async reconcile(now = new Date()) {
    const report = {
      verified: 0,
      ordersExpired: 0,
      refundsChecked: 0,
      discrepancies: 0,
      deliveriesPurged: 0,
      errors: 0,
    };

    const stale = await this.prisma.payment.findMany({
      where: {
        status: { in: OPEN },
        createdAt: { lt: new Date(now.getTime() - RECONCILE_AFTER_MS) },
      },
      select: { id: true },
      take: 200,
    });
    for (const p of stale) {
      try {
        await this.settle(p.id, 'reconcile');
        report.verified++;
      } catch {
        report.errors++;
      }
    }

    const expiring = await this.prisma.order.findMany({
      where: {
        status: { in: ['CREATED', 'AWAITING_PAYMENT'] },
        expiresAt: { lt: now },
        payments: { none: { status: { in: OPEN } } },
      },
      select: { id: true, status: true, propertyId: true },
      take: 500,
    });
    for (const o of expiring) {
      await this.prisma.$transaction(async (tx) => {
        const ok = await tx.order.updateMany({
          where: { id: o.id, status: o.status },
          data: { status: 'EXPIRED' },
        });
        if (ok.count === 1) await this.audit(tx, o.propertyId, 'order.expired', o.id, {});
      });
      report.ordersExpired++;
    }

    for (const r of await this.prisma.refund.findMany({
      where: { status: 'SUBMITTED', providerRefundId: { not: null } },
      select: { id: true },
      take: 200,
    })) {
      try {
        await this.checkRefund(r.id);
        report.refundsChecked++;
      } catch {
        report.errors++;
      }
    }

    const paidNoAccess = await this.prisma.order.findMany({
      where: {
        status: 'PAID',
        subscription: null,
        paidAt: { lt: new Date(now.getTime() - 60_000) },
      },
      select: {
        id: true,
        propertyId: true,
        payments: { where: { status: 'SUCCEEDED' }, select: { id: true }, take: 1 },
      },
      take: 100,
    });
    for (const o of paidNoAccess) {
      const exists = await this.prisma.reconciliationDiscrepancy.findFirst({
        where: {
          kind: 'PAID_WITHOUT_ENTITLEMENT',
          resolvedAt: null,
          details: { path: ['orderId'], equals: o.id },
        },
      });
      if (exists) continue;
      await this.prisma.$transaction((tx) =>
        this.discrepancy(
          tx,
          'PAID_WITHOUT_ENTITLEMENT',
          o.propertyId,
          o.payments[0]?.id ?? null,
          null,
          { orderId: o.id },
        ),
      );
      report.discrepancies++;
    }

    const purged = await this.prisma.voucherDelivery.deleteMany({
      where: { OR: [{ expiresAt: { lt: now } }, { voucher: { status: { notIn: ['ISSUED'] } } }] },
    });
    report.deliveriesPurged = purged.count;
    return report;
  }

  // ================================================================ helpers

  private money(amountMinor: bigint, currency: string) {
    if (!isCurrencyCode(currency)) throw new Error(`unsupported currency ${currency}`);
    return money(amountMinor, currency);
  }

  /** Move a payment through the state machine (CREATED is stepped via PENDING), guarded by its current status. */
  private async setPaymentStatus(
    tx: Tx,
    id: string,
    from: PaymentStatus,
    to: PaymentStatus,
    data: Prisma.PaymentUncheckedUpdateInput,
  ): Promise<void> {
    let current = from;
    if (
      current === 'CREATED' &&
      to !== 'PENDING' &&
      !paymentStateMachine.canTransition('CREATED', to)
    ) {
      paymentStateMachine.assertTransition('CREATED', 'PENDING');
      current = 'PENDING';
    }
    paymentStateMachine.assertTransition(current, to);
    const r = await tx.payment.updateMany({
      where: { id, status: from },
      data: { ...data, status: to } as Prisma.PaymentUncheckedUpdateManyInput,
    });
    if (r.count !== 1) throw new Error(`payment ${id} changed concurrently`);
  }

  private async setOrderStatus(
    tx: Tx,
    id: string,
    from: OrderStatus,
    to: OrderStatus,
    data: Prisma.OrderUncheckedUpdateManyInput,
  ): Promise<void> {
    let current = from;
    if (current === 'CREATED' && !orderStateMachine.canTransition('CREATED', to)) {
      orderStateMachine.assertTransition('CREATED', 'AWAITING_PAYMENT');
      current = 'AWAITING_PAYMENT';
    }
    orderStateMachine.assertTransition(current, to);
    const r = await tx.order.updateMany({
      where: { id, status: from },
      data: { ...data, status: to },
    });
    if (r.count !== 1) throw new Error(`order ${id} changed concurrently`);
  }

  private discrepancy(
    tx: Tx,
    kind: Parameters<Tx['reconciliationDiscrepancy']['create']>[0]['data']['kind'],
    propertyId: string | null,
    paymentId: string | null,
    entitlementId: string | null,
    details: Record<string, unknown>,
  ) {
    return tx.reconciliationDiscrepancy
      .create({
        data: {
          kind,
          propertyId,
          paymentId,
          entitlementId,
          details: details as Prisma.InputJsonValue,
        },
      })
      .then(async (d) => {
        await this.audit(tx, propertyId, 'reconciliation.discrepancy', d.id, { kind, paymentId });
      });
  }

  private audit(
    tx: Tx,
    propertyId: string | null,
    action: string,
    targetId: string,
    metadata: Record<string, unknown>,
  ) {
    const targetType = action.split('.')[0] ?? 'payment';
    return recordAudit(tx, {
      actorType: 'SYSTEM',
      propertyId,
      action,
      targetType,
      targetId,
      metadata,
    });
  }
}
