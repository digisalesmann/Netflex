import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { DefaultAdapterRegistry } from '@netflex/core';
import type { PrismaClient } from '@netflex/database';
import { normalizeMac } from '@netflex/domain';
import { z } from 'zod';
import { accessState } from '../access/lifecycle.service.js';
import type { AppRequest } from '../auth/auth.types.js';
import { OptionalAuth, Public } from '../auth/decorators.js';
import { ZodPipe, uuid } from '../common/zod.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { ADAPTER_REGISTRY, PRISMA } from '../infra/tokens.js';
import { RedemptionService } from '../vouchers/redemption.service.js';

/** What the gateway put in the captive-portal redirect (never trusted until confirmed). */
const Context = z.strictObject({
  gw: uuid,
  ip: z
    .string()
    .trim()
    .regex(/^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]{2,39}$/),
  mac: z.string().trim().max(20),
});
const Redeem = Context.extend({ code: z.string().max(40) });
const LIMIT_CONTEXT = { name: 'portal-ip', limit: 60, windowSeconds: 60 };

type Verified =
  | {
      ok: true;
      propertyId: string;
      gatewayId: string;
      mac: string;
      property: {
        name: string;
        slug: string;
        timeZone: string;
        supportPhone: string | null;
        supportEmail: string | null;
      };
    }
  | {
      ok: false;
      state: 'GATEWAY_UNAVAILABLE' | 'RECONNECT_REQUIRED';
      property: {
        name: string;
        slug: string;
        supportPhone: string | null;
        supportEmail: string | null;
      } | null;
    };

/**
 * Captive portal (spec §12). The device identity comes from the gateway's
 * redirect, but it is only accepted after the server asks the gateway itself
 * which device holds that IP right now. Without a reachable gateway adapter the
 * portal says "gateway unavailable" instead of pretending.
 */
@Public()
@OptionalAuth()
@ApiTags('portal')
@Controller({ path: 'portal' })
export class PortalController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(ADAPTER_REGISTRY) private readonly registry: DefaultAdapterRegistry,
    @Inject(RedemptionService) private readonly redemption: RedemptionService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
  ) {}

  private async verify(
    ctx: z.infer<typeof Context>,
    clientIp: string | undefined,
  ): Promise<Verified> {
    await this.limits.hit(LIMIT_CONTEXT, clientIp ?? ctx.ip);
    const gw = await this.prisma.gateway.findUnique({
      where: { id: ctx.gw },
      include: {
        property: {
          select: {
            name: true,
            slug: true,
            timeZone: true,
            supportPhone: true,
            supportEmail: true,
          },
        },
      },
    });
    if (!gw) return { ok: false, state: 'RECONNECT_REQUIRED', property: null };
    const property = gw.property;
    const mac = normalizeMac(ctx.mac);
    if (!mac) return { ok: false, state: 'RECONNECT_REQUIRED', property };
    const adapter = gw.status === 'DISABLED' ? null : this.registry.forGateway(gw);
    if (!adapter) return { ok: false, state: 'GATEWAY_UNAVAILABLE', property };
    const seen = await adapter.lookupClient(ctx.ip);
    if (seen && 'unreachable' in seen) return { ok: false, state: 'GATEWAY_UNAVAILABLE', property };
    if (!seen || normalizeMac(seen.macAddress) !== mac)
      return { ok: false, state: 'RECONNECT_REQUIRED', property };
    return { ok: true, propertyId: gw.propertyId, gatewayId: gw.id, mac, property };
  }

  /** Branding and support contacts for the portal header. */
  @Post('context')
  @HttpCode(200)
  async context(@Req() req: AppRequest, @Body(new ZodPipe(Context)) body: z.infer<typeof Context>) {
    const v = await this.verify(body, req.ip);
    const p = v.property;
    return {
      gateway: v.ok ? 'AVAILABLE' : v.state,
      property: p
        ? { name: p.name, slug: p.slug, supportPhone: p.supportPhone, supportEmail: p.supportEmail }
        : null,
    };
  }

  @Post('redeem')
  @HttpCode(200)
  async redeem(@Req() req: AppRequest, @Body(new ZodPipe(Redeem)) body: z.infer<typeof Redeem>) {
    const v = await this.verify(body, req.ip);
    if (!v.ok) return { state: v.state };
    const r = await this.redemption.redeem({
      propertyId: v.propertyId,
      code: body.code,
      macAddress: v.mac,
      userId: req.auth?.user.kind === 'TENANT' ? req.auth.user.id : null,
      clientKey: `${v.gatewayId}:${v.mac}`,
    });
    return r.ok ? { state: r.state, expiresAt: r.expiresAt } : { state: r.state };
  }

  /** Current access for THIS device (spec §12: "Connected" only after gateway confirmation). */
  @Post('status')
  @HttpCode(200)
  async status(@Req() req: AppRequest, @Body(new ZodPipe(Context)) body: z.infer<typeof Context>) {
    const v = await this.verify(body, req.ip);
    if (!v.ok) return { state: v.state };
    const device = await this.prisma.device.findUnique({
      where: { propertyId_macAddress: { propertyId: v.propertyId, macAddress: v.mac } },
    });
    const binding = device
      ? await this.prisma.voucherRedemption.findFirst({
          where: { deviceId: device.id, releasedAt: null },
          orderBy: { redeemedAt: 'desc' },
          include: {
            entitlement: { include: { subscription: { select: { planSnapshot: true } } } },
          },
        })
      : null;
    if (!binding) return { state: 'NOT_CONNECTED' };
    const e = binding.entitlement;
    const remaining = e.expiresAt
      ? Math.max(0, Math.floor((e.expiresAt.getTime() - Date.now()) / 1000))
      : null;
    const s = accessState(e.status, e.observedNetworkState, remaining);
    const state =
      s === 'ACTIVE' ? 'CONNECTED' : s === 'EXPIRING_SOON' ? 'CONNECTED_EXPIRING_SOON' : s;
    const plan = e.subscription.planSnapshot as { name?: string };
    return {
      state,
      planName: plan.name ?? null,
      expiresAt: e.expiresAt?.toISOString() ?? null,
      expiresAtLocal: e.expiresAt
        ? new Intl.DateTimeFormat('en-NG', {
            timeZone: v.property.timeZone,
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(e.expiresAt)
        : null,
      remainingSeconds: remaining,
    };
  }
}
