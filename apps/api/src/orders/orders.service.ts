import { createHmac } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { NetflexConfig } from '@netflex/config';
import { Prisma, type PrismaClient } from '@netflex/database';
import {
  assertTargetInProperty,
  canPurchaseFor,
  checkPurchasable,
  formatMoney,
  generateOrderReference,
  snapshotToJson,
  type ScopeTarget,
  type PlanVersionSnapshot,
  computeRenewalWindow,
} from '@netflex/domain';
import { deriveKey, keyedVerifier } from '@netflex/security';
import { AuditService, type Tx } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import type { RequestMetaValue } from '../auth/decorators.js';
import { toSnapshot } from '../catalog/plan-mapper.js';
import { ApiError } from '../common/api-error.js';
import { IdempotencyService, requestHash } from '../common/idempotency.service.js';
import { notFound } from '../common/prisma-errors.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { CONFIG, PRISMA } from '../infra/tokens.js';

const ORDER_TTL_MS = 30 * 60_000;
const LIMIT_IP = { name: 'order-create-ip', limit: 20, windowSeconds: 3600 };
const LIMIT_PHONE = { name: 'order-create-phone', limit: 10, windowSeconds: 3600 };

export type OrderTargetInput =
  { scope: 'INDIVIDUAL' } | { scope: 'ROOM'; roomId: string } | { scope: 'FLOOR'; floorId: string };

export interface CreateOrderInput {
  planVersionId: string;
  target: OrderTargetInput;
  customerPhone?: string;
  /** Explicit renewal of existing access (signed-in owner/manager only). */
  renewEntitlementId?: string;
}

const unprocessable = (code: string, message: string) =>
  new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, `DOMAIN_${code}`, message);

/**
 * Orders capture purchase intent with an immutable, server-computed price
 * (spec §10, §13.1). Payment is attached in Phase 4.
 */
@Injectable()
export class OrdersService {
  private readonly tokenKey: Buffer;
  private readonly verifierKey: Buffer;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CONFIG) private readonly config: NetflexConfig,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
  ) {
    this.tokenKey = deriveKey(config.AUTH_SECRET, 'order-access-token');
    this.verifierKey = deriveKey(config.AUTH_SECRET, 'order-access-verifier');
  }

  /** Guest order token: derived from the order id with a server key, so retries can return it without storing it. */
  guestToken(orderId: string): string {
    return createHmac('sha256', this.tokenKey).update(orderId).digest('base64url');
  }

  async create(
    auth: AuthContext | undefined,
    input: CreateOrderInput,
    idemKey: string,
    meta: RequestMetaValue,
  ) {
    if (auth && auth.user.kind !== 'TENANT') {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Staff accounts cannot buy plans. Issue a voucher instead.',
      );
    }
    if (!auth && !input.customerPhone) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'A phone number is required for guest checkout.',
        {
          fields: [{ path: 'customerPhone', rule: 'required' }],
        },
      );
    }
    await this.limits.hit(LIMIT_IP, meta.ip ?? 'unknown');
    if (!auth && input.customerPhone) await this.limits.hit(LIMIT_PHONE, input.customerPhone);

    const identity = auth ? `user:${auth.user.id}` : `guest:${input.customerPhone}`;
    const result = await this.idempotency.run(
      'POST /orders:' + identity,
      idemKey,
      requestHash({ identity, input }),
      async (tx) => {
        const order = await this.createInTx(tx, auth, input, idemKey, meta);
        return { status: 201, body: order };
      },
    );
    const body = result.body as Record<string, unknown> & { orderId: string; guest: boolean };
    return {
      status: result.status,
      replayed: result.replayed,
      body: body.guest ? { ...body, accessToken: this.guestToken(body.orderId) } : body,
    };
  }

  private async createInTx(
    tx: Tx,
    auth: AuthContext | undefined,
    input: CreateOrderInput,
    idemKey: string,
    meta: RequestMetaValue,
  ) {
    const version = await tx.planVersion.findUnique({
      where: { id: input.planVersionId },
      include: { plan: { include: { property: true } } },
    });
    if (!version?.publishedAt) throw notFound();
    const plan = version.plan;
    const latest = await tx.planVersion.findFirst({
      where: { planId: plan.id, publishedAt: { not: null } },
      orderBy: { version: 'desc' },
    });
    if (latest?.id !== version.id) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'CONFLICT',
        'This plan has been updated. Refresh to see the current terms.',
      );
    }
    const snapshot = toSnapshot(plan, version);
    const now = new Date();
    const eligibility = checkPurchasable(snapshot, {
      now,
      propertyId: plan.propertyId,
      scope: input.target.scope,
      paidAccessEnabled: this.config.PAID_ACCESS_ENABLED,
    });
    if (!eligibility.ok) {
      throw unprocessable(
        eligibility.reason,
        eligibility.reason === 'PAID_ACCESS_DISABLED'
          ? 'Online purchases are not open yet.'
          : 'This plan cannot be bought right now.',
      );
    }

    // Resolve the target and check purchase authority (spec §7: explicit, never inferred).
    let target: ScopeTarget;
    if (input.target.scope === 'INDIVIDUAL') {
      target = { scope: 'INDIVIDUAL', userId: auth?.user.id ?? 'guest' };
    } else {
      if (!auth)
        throw new ApiError(
          HttpStatus.UNAUTHORIZED,
          'UNAUTHENTICATED',
          'Sign in to buy room or floor access.',
        );
      if (input.target.scope === 'ROOM') {
        const room = await tx.room.findFirst({
          where: { id: input.target.roomId, propertyId: plan.propertyId },
          select: { id: true, floorId: true, propertyId: true },
        });
        assertTargetInProperty(
          { scope: 'ROOM', roomId: input.target.roomId },
          room && { propertyId: room.propertyId, floorId: room.floorId, roomId: room.id },
          plan.propertyId,
        );
        target = { scope: 'ROOM', roomId: input.target.roomId };
      } else {
        const floor = await tx.floor.findFirst({
          where: { id: input.target.floorId, propertyId: plan.propertyId },
          select: { id: true, propertyId: true },
        });
        assertTargetInProperty(
          { scope: 'FLOOR', floorId: input.target.floorId },
          floor && { propertyId: floor.propertyId, floorId: floor.id, roomId: null },
          plan.propertyId,
        );
        target = { scope: 'FLOOR', floorId: input.target.floorId };
      }
      const authorities = await tx.groupAuthority.findMany({
        where: { userId: auth.user.id, propertyId: plan.propertyId, revokedAt: null },
      });
      const allowed = canPurchaseFor(
        {
          userId: auth.user.id,
          propertyId: plan.propertyId,
          roomIds: new Set(authorities.flatMap((a) => (a.roomId ? [a.roomId] : []))),
          floorIds: new Set(authorities.flatMap((a) => (a.floorId ? [a.floorId] : []))),
        },
        target,
        plan.propertyId,
      );
      if (!allowed)
        throw new ApiError(
          HttpStatus.FORBIDDEN,
          'FORBIDDEN',
          'You are not authorized to buy access for this room or floor. Ask the property office.',
        );
    }

    if (input.renewEntitlementId) {
      await this.assertRenewable(
        tx,
        auth,
        input.renewEntitlementId,
        plan.id,
        plan.propertyId,
        target,
        snapshot,
        plan.property.timeZone,
      );
    }

    // Lock the version: from now on its terms can never change (DB trigger enforces).
    if (!version.lockedAt)
      await tx.planVersion.updateMany({
        where: { id: version.id, lockedAt: null },
        data: { lockedAt: now },
      });

    let order;
    for (let attempt = 0; ; attempt++) {
      try {
        order = await tx.order.create({
          data: {
            reference: generateOrderReference(),
            propertyId: plan.propertyId,
            customerUserId: auth?.user.id ?? null,
            customerPhone: auth ? null : (input.customerPhone ?? null),
            planVersionId: version.id,
            scope: target.scope,
            targetUserId: target.scope === 'INDIVIDUAL' ? (auth?.user.id ?? null) : null,
            targetRoomId: target.scope === 'ROOM' ? target.roomId : null,
            targetFloorId: target.scope === 'FLOOR' ? target.floorId : null,
            amountMinor: snapshot.price.amountMinor,
            currency: snapshot.price.currency,
            planSnapshot: snapshotToJson({
              ...snapshot,
              status: 'PUBLISHED',
            }) as unknown as Prisma.InputJsonValue,
            expiresAt: new Date(now.getTime() + ORDER_TTL_MS),
            idempotencyKey: idemKey,
            renewsEntitlementId: input.renewEntitlementId ?? null,
            // Placeholder satisfies the guest CHECK; replaced below once the id is known.
            accessTokenVerifier: auth ? null : '0'.repeat(64),
          },
        });
        break;
      } catch (e) {
        if (attempt < 3 && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
          continue;
        throw e;
      }
    }
    if (!auth) {
      // accessTokenVerifier is not one of the immutable order fields.
      order = await tx.order.update({
        where: { id: order.id },
        data: { accessTokenVerifier: keyedVerifier(this.verifierKey, this.guestToken(order.id)) },
      });
    }
    await this.audit.record(tx, {
      actorType: 'USER',
      actorUserId: auth?.user.id ?? null,
      propertyId: plan.propertyId,
      action: 'order.created',
      targetType: 'order',
      targetId: order.id,
      correlationId: meta.requestId,
      ipAddress: meta.ip,
      metadata: {
        reference: order.reference,
        planVersionId: version.id,
        amountMinor: order.amountMinor.toString(),
        currency: order.currency,
        guest: !auth,
      },
    });
    return this.view(order, version.name, !auth);
  }

  /**
   * Renewal is explicit and checked up front (spec §9): the caller must own or
   * manage the access, it must be the same plan and target, the access must have
   * started and not ended, and the plan's renewal rule must not shorten it.
   */
  private async assertRenewable(
    tx: Tx,
    auth: AuthContext | undefined,
    entitlementId: string,
    planId: string,
    propertyId: string,
    target: ScopeTarget,
    snapshot: PlanVersionSnapshot,
    timeZone: string,
  ) {
    if (!auth)
      throw new ApiError(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
        'Sign in to renew your access.',
      );
    const e = await tx.entitlement.findFirst({
      where: { id: entitlementId, propertyId },
      include: {
        subscription: {
          include: {
            planVersion: { select: { planId: true } },
            memberships: { where: { userId: auth.user.id, removedAt: null, role: 'MANAGER' } },
          },
        },
      },
    });
    const owns =
      !!e &&
      (e.subscription.ownerUserId === auth.user.id ||
        e.targetUserId === auth.user.id ||
        e.subscription.memberships.length > 0);
    if (!e || !owns) throw notFound();
    if (e.subscription.planVersion.planId !== planId) {
      throw unprocessable(
        'RENEWAL_PLAN_MISMATCH',
        'Renewals must use the same plan. Buy the new plan separately instead.',
      );
    }
    const sameTarget =
      (target.scope === 'INDIVIDUAL' && e.scope === 'INDIVIDUAL') ||
      (target.scope === 'ROOM' && e.targetRoomId === target.roomId) ||
      (target.scope === 'FLOOR' && e.targetFloorId === target.floorId);
    if (!sameTarget)
      throw unprocessable(
        'RENEWAL_TARGET_MISMATCH',
        'A renewal must be for the same room, floor or person.',
      );
    if (['EXPIRED', 'REVOKED'].includes(e.status) || (e.expiresAt && e.expiresAt <= new Date())) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'CONFLICT',
        'This access has ended. Buy a new plan instead of renewing.',
      );
    }
    if (!e.expiresAt) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'CONFLICT',
        'This access has not started yet. You can renew once it is active.',
      );
    }
    const w = computeRenewalWindow({
      now: new Date(),
      currentExpiresAt: e.expiresAt,
      duration: snapshot.duration,
      timeZone,
      rule: snapshot.renewalRule,
    });
    if (w.shortensCurrent) {
      throw unprocessable(
        'RENEWAL_WOULD_SHORTEN',
        "This plan's renewal rule would end your current access early, so it can't be used to renew now.",
      );
    }
  }

  view(
    order: {
      id: string;
      reference: string;
      status: string;
      scope: string;
      amountMinor: bigint;
      currency: string;
      expiresAt: Date;
      createdAt: Date;
    },
    planName: string,
    guest: boolean,
  ) {
    return {
      orderId: order.id,
      reference: order.reference,
      status: order.status,
      planName,
      scope: order.scope,
      amount: {
        amountMinor: order.amountMinor.toString(),
        currency: order.currency,
        display: formatMoney({ amountMinor: order.amountMinor, currency: order.currency as 'NGN' }),
      },
      expiresAt: order.expiresAt.toISOString(),
      createdAt: order.createdAt.toISOString(),
      guest,
    };
  }

  /** Owner (tenant session) or guest with the order token. Anything else is "not found". */
  async loadAccessible(
    orderId: string,
    auth: AuthContext | undefined,
    guestToken: string | undefined,
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw notFound();
    const ownerOk = auth?.user.kind === 'TENANT' && order.customerUserId === auth.user.id;
    const guestOk =
      !!guestToken &&
      guestToken.length < 100 &&
      order.accessTokenVerifier !== null &&
      keyedVerifier(this.verifierKey, guestToken) === order.accessTokenVerifier;
    if (!ownerOk && !guestOk) throw notFound();
    return order;
  }

  /**
   * Customer-facing order status (spec §16 truthful statuses). Network access
   * state is reported separately once the gateway integration exists.
   */
  async read(orderId: string, auth: AuthContext | undefined, guestToken: string | undefined) {
    const order = await this.loadAccessible(orderId, auth, guestToken);
    const [version, latest, delivery] = await Promise.all([
      this.prisma.planVersion.findUniqueOrThrow({
        where: { id: order.planVersionId },
        select: { name: true },
      }),
      this.prisma.payment.findFirst({
        where: { orderId },
        orderBy: { createdAt: 'desc' },
        select: { status: true, createdAt: true },
      }),
      this.prisma.voucherDelivery.findFirst({
        where: { orderId, expiresAt: { gt: new Date() }, voucher: { status: 'ISSUED' } },
        select: { voucherId: true },
      }),
    ]);
    const stage =
      order.status === 'PAID'
        ? delivery
          ? 'VOUCHER_AVAILABLE'
          : 'PAYMENT_CONFIRMED'
        : order.status === 'AWAITING_PAYMENT'
          ? latest?.status === 'FAILED' || latest?.status === 'ABANDONED'
            ? 'PAYMENT_FAILED'
            : 'PAYMENT_PENDING'
          : order.status;
    return {
      ...this.view(order, version.name, order.customerUserId === null),
      stage,
      payment: latest ? { status: latest.status, startedAt: latest.createdAt.toISOString() } : null,
      voucherAvailable: !!delivery,
    };
  }
}
