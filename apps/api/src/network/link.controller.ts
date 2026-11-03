import { timingSafeEqual } from 'node:crypto';
import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import {
  LINK_COMMAND_TTL_MS,
  newLinkToken,
  normalizePairingCode,
  recordAudit,
  sha256,
} from '@netflex/core';
import type { Prisma, PrismaClient } from '@netflex/database';
import { z } from 'zod';
import type { AppRequest } from '../auth/auth.types.js';
import { Public, SkipCsrf } from '../auth/decorators.js';
import { ApiError } from '../common/api-error.js';
import { ZodPipe, uuid } from '../common/zod.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { PRISMA } from '../infra/tokens.js';

export const LINK_HEADER = 'x-netflex-link';
const safe = (max: number) => z.string().trim().max(max);

const Pair = z.strictObject({ code: z.string().trim().min(8).max(12), agentVersion: safe(40) });
const Heartbeat = z.strictObject({
  agentVersion: safe(40),
  protocol: z.number().int().min(1).max(100),
  controller: z.strictObject({
    reachable: z.boolean(),
    version: safe(40).nullable(),
    detail: safe(200),
  }),
  features: z.strictObject({ unauthorize: z.boolean(), listClients: z.boolean() }),
});
const Poll = z.strictObject({
  heartbeat: Heartbeat,
  /** How long to hold the request open when there is nothing to do (long poll). */
  waitMs: z.number().int().min(0).max(25_000).default(25_000),
});
const Result = z.strictObject({
  id: uuid,
  ok: z.boolean(),
  result: z.record(z.string(), z.unknown()).optional(),
  error: safe(200).optional(),
});

const PAIR_LIMIT = { name: 'link-pair', limit: 10, windowSeconds: 600 };

/**
 * Endpoints for the lodge link (apps/lodge-link). It has no cookies; it proves
 * itself with the long random token it got when it was paired in the office.
 * Only a hash of that token is stored.
 */
@Public()
@SkipCsrf()
@ApiExcludeController()
@Controller({ path: 'link' })
export class LinkController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
  ) {}

  private async linkFor(req: AppRequest) {
    const raw = req.headers[LINK_HEADER];
    const token = typeof raw === 'string' ? raw.trim() : '';
    if (!token.startsWith('nfl_') || token.length > 100) throw this.denied();
    const hash = sha256(token);
    const link = await this.prisma.lodgeLink.findUnique({
      where: { tokenHash: hash },
      include: { gateway: { select: { id: true, propertyId: true, status: true } } },
    });
    if (!link?.tokenHash || !timingSafeEqual(Buffer.from(link.tokenHash), Buffer.from(hash)))
      throw this.denied();
    return link;
  }

  private denied() {
    return new ApiError(
      HttpStatus.UNAUTHORIZED,
      'UNAUTHENTICATED',
      'This lodge link is not paired.',
    );
  }

  /** Swap the one-time code from the office for a long-lived link token. */
  @Post('pair')
  @HttpCode(200)
  async pair(@Req() req: AppRequest, @Body(new ZodPipe(Pair)) body: z.infer<typeof Pair>) {
    await this.limits.hit(PAIR_LIMIT, req.ip ?? 'unknown');
    const hash = sha256(normalizePairingCode(body.code));
    const link = await this.prisma.lodgeLink.findFirst({
      where: { pairingCodeHash: hash, pairingExpiresAt: { gt: new Date() } },
      include: { gateway: { select: { id: true, propertyId: true, name: true } } },
    });
    if (!link)
      throw new ApiError(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
        'That pairing code is wrong or has expired. Make a new one in the office (Network).',
      );
    const token = newLinkToken();
    await this.prisma.$transaction(async (tx) => {
      // The code works once: clearing it here makes a second use fail.
      const done = await tx.lodgeLink.updateMany({
        where: { id: link.id, pairingCodeHash: hash },
        data: {
          pairingCodeHash: null,
          pairingExpiresAt: null,
          tokenHash: sha256(token),
          pairedAt: new Date(),
          lastSeenAt: new Date(),
          agentVersion: body.agentVersion,
          controllerOk: false,
          detail: 'Paired; waiting for the first check-in',
        },
      });
      if (done.count !== 1) throw this.denied();
      await recordAudit(tx, {
        actorType: 'SYSTEM',
        propertyId: link.gateway.propertyId,
        action: 'gateway.link_paired',
        targetType: 'gateway',
        targetId: link.gateway.id,
        metadata: { agentVersion: body.agentVersion },
      });
    });
    return { token, gatewayId: link.gateway.id, gatewayName: link.gateway.name };
  }

  /** Check in: report health, collect instructions (waits up to waitMs if there are none). */
  @Post('poll')
  @HttpCode(200)
  async poll(@Req() req: AppRequest, @Body(new ZodPipe(Poll)) body: z.infer<typeof Poll>) {
    const link = await this.linkFor(req);
    const hb = body.heartbeat;
    await this.prisma.lodgeLink.update({
      where: { id: link.id },
      data: {
        lastSeenAt: new Date(),
        agentVersion: hb.agentVersion,
        controllerOk: hb.controller.reachable,
        controllerVersion: hb.controller.version,
        detail: hb.controller.detail,
        features: hb.features as unknown as Prisma.InputJsonValue,
      },
    });
    const gatewayId = link.gateway.id;
    const deadline = Date.now() + body.waitMs;
    for (;;) {
      await this.prisma.linkCommand.updateMany({
        where: {
          gatewayId,
          status: 'PENDING',
          createdAt: { lt: new Date(Date.now() - LINK_COMMAND_TTL_MS) },
        },
        data: { status: 'EXPIRED' },
      });
      const pending = await this.prisma.linkCommand.findMany({
        where: { gatewayId, status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        take: 20,
        select: { id: true, kind: true, payload: true },
      });
      if (pending.length) {
        const claimed = await this.prisma.linkCommand.updateMany({
          where: { id: { in: pending.map((p) => p.id) }, status: 'PENDING' },
          data: { status: 'SENT', sentAt: new Date() },
        });
        if (claimed.count) {
          await this.prisma.lodgeLink.update({
            where: { id: link.id },
            data: { lastSeenAt: new Date() },
          });
          return { commands: pending };
        }
      }
      if (Date.now() >= deadline || req.socket.destroyed) return { commands: [] };
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  @Post('result')
  @HttpCode(200)
  async result(@Req() req: AppRequest, @Body(new ZodPipe(Result)) body: z.infer<typeof Result>) {
    const link = await this.linkFor(req);
    const done = await this.prisma.linkCommand.updateMany({
      where: { id: body.id, gatewayId: link.gateway.id, status: 'SENT' },
      data: {
        status: body.ok ? 'DONE' : 'FAILED',
        result: (body.result ?? {}) as Prisma.InputJsonValue,
        error: body.ok ? null : (body.error ?? 'failed'),
        doneAt: new Date(),
      },
    });
    await this.prisma.lodgeLink.update({
      where: { id: link.id },
      data: { lastSeenAt: new Date() },
    });
    return { accepted: done.count === 1 };
  }
}
