import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { recordAudit } from '@netflex/core';
import type { Prisma, PrismaClient } from '@netflex/database';
import { formatMoney, isCurrencyCode, money } from '@netflex/domain';
import { z } from 'zod';
import type { AuthContext } from '../auth/auth.types.js';
import {
  CurrentAuth,
  RequestMeta,
  RequireKind,
  type RequestMetaValue,
} from '../auth/decorators.js';
import { notFound } from '../common/prisma-errors.js';
import { ZodPipe } from '../common/zod.js';
import { PRISMA } from '../infra/tokens.js';

const Profile = z.strictObject({ displayName: z.string().trim().min(1).max(120) });
const channelPrefs = z.strictObject({
  expiryReminders: z.boolean(),
  receipts: z.boolean(),
  outageNotices: z.boolean(),
});
const Preferences = z.strictObject({ sms: channelPrefs, email: channelPrefs });
const Erasure = z.strictObject({ details: z.string().trim().max(1000).optional() });

export const DEFAULT_PREFS = {
  sms: { expiryReminders: true, receipts: true, outageNotices: true },
  email: { expiryReminders: false, receipts: false, outageNotices: false },
};

const fmt = (amountMinor: bigint, currency: string) =>
  isCurrencyCode(currency)
    ? formatMoney(money(amountMinor, currency))
    : `${currency} ${amountMinor}`;

/**
 * Tenant self-service account data (spec §16): profile, transaction history,
 * receipts, notification preferences and privacy controls. Every query is
 * scoped to the signed-in tenant.
 */
@RequireKind('TENANT')
@ApiTags('me: account')
@Controller({ path: 'me' })
export class AccountController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Patch()
  async profile(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(Profile)) body: z.infer<typeof Profile>,
  ) {
    const u = await this.prisma.user.update({
      where: { id: auth.user.id },
      data: { displayName: body.displayName },
      select: { displayName: true },
    });
    return u;
  }

  @Get('orders')
  async orders(@CurrentAuth() auth: AuthContext) {
    const rows = await this.prisma.order.findMany({
      where: { customerUserId: auth.user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        planVersion: { select: { name: true } },
        property: { select: { name: true } },
        payments: { select: { status: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    return rows.map((o) => ({
      orderId: o.id,
      reference: o.reference,
      property: o.property.name,
      planName: o.planVersion.name,
      status: o.status,
      paymentStatus: o.payments[0]?.status ?? null,
      amount: {
        amountMinor: o.amountMinor.toString(),
        currency: o.currency,
        display: fmt(o.amountMinor, o.currency),
      },
      createdAt: o.createdAt.toISOString(),
      paidAt: o.paidAt?.toISOString() ?? null,
      renewal: o.renewsEntitlementId !== null,
    }));
  }

  /** Receipt for a paid (or refunded) order. Not a tax invoice (tax treatment is an owner/adviser decision, gate G3). */
  @Get('orders/:orderId/receipt')
  async receipt(
    @CurrentAuth() auth: AuthContext,
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
  ) {
    const o = await this.prisma.order.findFirst({
      where: { id: orderId, customerUserId: auth.user.id, status: { in: ['PAID', 'REFUNDED'] } },
      include: {
        property: {
          select: { name: true, supportPhone: true, supportEmail: true, timeZone: true },
        },
        payments: {
          where: { status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } },
          include: { refunds: { where: { status: 'SUCCEEDED' } } },
        },
      },
    });
    if (!o) throw notFound();
    const snap = o.planSnapshot as {
      name?: string;
      duration?: { value: number; unit: string };
      scope?: string;
      maxDevices?: number;
      termsVersion?: string;
    };
    const local = (d: Date | null) =>
      d
        ? new Intl.DateTimeFormat('en-NG', {
            timeZone: o.property.timeZone,
            dateStyle: 'long',
            timeStyle: 'short',
          }).format(d)
        : null;
    const pay = o.payments[0];
    const refunded = o.payments.flatMap((p) => p.refunds).reduce((a, r) => a + r.amountMinor, 0n);
    return {
      receiptFor: o.reference,
      issuedBy: o.property.name,
      paidAt: local(o.paidAt),
      item: {
        plan: snap.name ?? null,
        duration: snap.duration ?? null,
        scope: snap.scope ?? null,
        maxDevices: snap.maxDevices ?? null,
        termsVersion: snap.termsVersion ?? null,
      },
      amount: {
        amountMinor: o.amountMinor.toString(),
        currency: o.currency,
        display: fmt(o.amountMinor, o.currency),
      },
      payment: pay
        ? {
            provider: pay.provider === 'PAYSTACK' ? 'Paystack' : 'Simulated (test)',
            reference: pay.providerReference,
            status: pay.status,
          }
        : null,
      refunded:
        refunded > 0n
          ? { amountMinor: refunded.toString(), display: fmt(refunded, o.currency) }
          : null,
      status: o.status,
      support: { phone: o.property.supportPhone, email: o.property.supportEmail },
      note: 'Payment receipt. This is not a tax invoice.',
    };
  }

  @Get('preferences')
  async getPreferences(@CurrentAuth() auth: AuthContext) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: auth.user.id },
      select: { notificationPrefs: true },
    });
    return {
      preferences: { ...DEFAULT_PREFS, ...(u.notificationPrefs as object) },
      // Honest about delivery: no SMS/email provider is configured yet (assumption A13).
      channelsAvailable: { sms: false, email: false },
    };
  }

  @Put('preferences')
  async setPreferences(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(Preferences)) body: z.infer<typeof Preferences>,
  ) {
    await this.prisma.user.update({
      where: { id: auth.user.id },
      data: { notificationPrefs: body as Prisma.InputJsonValue },
    });
    return { preferences: body };
  }

  /** Download of the tenant's own data (spec §24 data requests). No codes, tokens or other people's data. */
  @Get('export')
  @Header('Content-Disposition', 'attachment; filename="netflex-my-data.json"')
  async exportData(@CurrentAuth() auth: AuthContext, @RequestMeta() meta: RequestMetaValue) {
    const id = auth.user.id;
    const [user, assignments, orders, entitlements, devices, sessions, tickets] = await Promise.all(
      [
        this.prisma.user.findUniqueOrThrow({
          where: { id },
          select: {
            displayName: true,
            phoneE164: true,
            createdAt: true,
            lastLoginAt: true,
            notificationPrefs: true,
          },
        }),
        this.prisma.tenantAssignment.findMany({
          where: { userId: id },
          select: {
            startsAt: true,
            endsAt: true,
            room: { select: { label: true } },
            property: { select: { name: true } },
          },
        }),
        this.prisma.order.findMany({
          where: { customerUserId: id },
          select: {
            reference: true,
            status: true,
            amountMinor: true,
            currency: true,
            createdAt: true,
            paidAt: true,
          },
        }),
        this.prisma.entitlement.findMany({
          where: {
            OR: [
              { targetUserId: id },
              { subscription: { ownerUserId: id } },
              { subscription: { memberships: { some: { userId: id } } } },
            ],
          },
          select: { scope: true, status: true, startsAt: true, expiresAt: true },
        }),
        this.prisma.device.findMany({
          where: { userId: id },
          select: { macAddress: true, firstSeenAt: true, lastSeenAt: true, label: true },
        }),
        this.prisma.session.findMany({
          where: { userId: id },
          select: {
            createdAt: true,
            lastSeenAt: true,
            expiresAt: true,
            revokedAt: true,
            userAgent: true,
          },
        }),
        this.prisma.supportTicket.findMany({
          where: { requesterId: id },
          select: { category: true, subject: true, body: true, status: true, createdAt: true },
        }),
      ],
    );
    await this.prisma.$transaction((tx) =>
      recordAudit(tx, {
        actorType: 'USER',
        actorUserId: id,
        action: 'privacy.data_exported',
        targetType: 'user',
        targetId: id,
        correlationId: meta.requestId,
        ipAddress: meta.ip,
      }),
    );
    return {
      exportedAt: new Date().toISOString(),
      user,
      assignments,
      orders,
      entitlements,
      devices,
      signInSessions: sessions,
      supportTickets: tickets,
    };
  }

  /**
   * Erasure request. Recorded as a PRIVACY ticket for staff: financial and audit
   * records must be kept for their retention period, so erasure is a reviewed
   * process, not an instant delete.
   */
  @Post('privacy/erasure-request')
  async erasure(
    @CurrentAuth() auth: AuthContext,
    @RequestMeta() meta: RequestMetaValue,
    @Body(new ZodPipe(Erasure)) body: z.infer<typeof Erasure>,
  ) {
    const assignment = await this.prisma.tenantAssignment.findFirst({
      where: { userId: auth.user.id },
      orderBy: { startsAt: 'desc' },
      select: { propertyId: true },
    });
    const order = assignment
      ? null
      : await this.prisma.order.findFirst({
          where: { customerUserId: auth.user.id },
          select: { propertyId: true },
        });
    const propertyId = assignment?.propertyId ?? order?.propertyId;
    if (!propertyId) {
      return {
        status: 'NO_PROPERTY_DATA',
        message:
          'We hold no property records for you beyond your sign-in. You can delete your account by contacting support.',
      };
    }
    return this.prisma.$transaction(async (tx) => {
      const t = await tx.supportTicket.create({
        data: {
          propertyId,
          requesterId: auth.user.id,
          category: 'PRIVACY',
          subject: 'Data erasure request',
          body: body.details ?? 'Please erase my personal data where the law allows.',
        },
        select: { id: true },
      });
      await recordAudit(tx, {
        actorType: 'USER',
        actorUserId: auth.user.id,
        propertyId,
        action: 'privacy.erasure_requested',
        targetType: 'support_ticket',
        targetId: t.id,
        correlationId: meta.requestId,
        ipAddress: meta.ip,
      });
      return {
        status: 'REQUESTED',
        ticketId: t.id,
        message:
          'Request received. Some payment records must be kept by law; the team will explain what can be erased.',
      };
    });
  }
}
