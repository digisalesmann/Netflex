import { Controller, Get, Inject, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Prisma, PrismaClient } from '@netflex/database';
import { can, type Permission } from '@netflex/domain';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { PRISMA } from '../infra/tokens.js';

const DAY = 86_400_000;

/**
 * One-call summary for the office overview. Each section is included only when
 * the caller holds the matching permission, so nobody sees more than their role allows.
 */
@ApiTags('admin')
@Controller({ path: 'admin/properties/:propertyId' })
export class OverviewController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @RequirePermission('property.read')
  @Get('overview')
  async overview(
    @CurrentAuth() auth: AuthContext,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
  ) {
    const has = (p: Permission) => can(auth.actor, p, propertyId);
    const now = new Date();
    const startOfToday = lagosMidnight(now);
    const db = this.prisma;

    const [rooms, occupied] = await Promise.all([
      db.room.count({ where: { propertyId } }),
      db.room.count({ where: { propertyId, assignments: { some: { endsAt: null } } } }),
    ]);

    const residents = has('tenant.read')
      ? await db.user.count({
          where: { kind: 'TENANT', assignments: { some: { propertyId, endsAt: null } } },
        })
      : null;

    const access = has('subscription.read')
      ? await Promise.all([
          db.entitlement.count({ where: { propertyId, status: 'ACTIVE' } }),
          db.entitlement.count({
            where: {
              propertyId,
              status: 'ACTIVE',
              expiresAt: { gt: now, lte: new Date(now.getTime() + 2 * DAY) },
            },
          }),
          db.entitlement.count({ where: { propertyId, status: 'PENDING_ACTIVATION' } }),
        ]).then(([active, expiringSoon, unused]) => ({ active, expiringSoon, unused }))
      : null;

    const paid = {
      order: { propertyId },
      status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED'] },
    } satisfies Prisma.PaymentWhereInput;
    const sales = has('payment.read')
      ? await Promise.all([
          db.payment.aggregate({
            where: { ...paid, verifiedAt: { gte: startOfToday } },
            _sum: { amountMinor: true },
            _count: true,
          }),
          db.payment.aggregate({
            where: { ...paid, verifiedAt: { gte: new Date(startOfToday.getTime() - 6 * DAY) } },
            _sum: { amountMinor: true },
            _count: true,
          }),
          db.payment.findMany({
            where: { order: { propertyId } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 6,
            select: {
              id: true,
              status: true,
              amountMinor: true,
              currency: true,
              createdAt: true,
              order: { select: { reference: true } },
            },
          }),
        ]).then(([today, week, recent]) => ({
          today: { amountMinor: (today._sum.amountMinor ?? 0n).toString(), count: today._count },
          week: { amountMinor: (week._sum.amountMinor ?? 0n).toString(), count: week._count },
          recent: recent.map((p) => ({ ...p, amountMinor: p.amountMinor.toString() })),
        }))
      : null;

    const attention = {
      refundsToApprove: has('payment.refund.approve')
        ? await db.refund.count({
            where: { status: 'REQUESTED', payment: { order: { propertyId } } },
          })
        : null,
      discrepancies: has('payment.reconcile')
        ? await db.reconciliationDiscrepancy.count({ where: { propertyId, resolvedAt: null } })
        : null,
      networkFailures: has('network.read')
        ? await db.networkOperation.count({ where: { propertyId, status: 'FAILED' } })
        : null,
      gatewaysDown: has('network.read')
        ? await db.gateway.count({
            where: { propertyId, status: { in: ['DEGRADED', 'UNREACHABLE'] } },
          })
        : null,
      provisioningFailed: has('subscription.read')
        ? await db.entitlement.count({ where: { propertyId, status: 'PROVISIONING_FAILED' } })
        : null,
    };

    return { rooms: { total: rooms, occupied }, residents, access, sales, attention };
  }
}

/** Midnight in Lagos (UTC+1, no daylight saving) as a UTC instant. */
function lagosMidnight(now: Date): Date {
  const lagos = new Date(now.getTime() + 3_600_000);
  return new Date(
    Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate()) - 3_600_000,
  );
}
