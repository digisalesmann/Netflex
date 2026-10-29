import { randomBytes } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { assertSimulatorAllowed, type NetflexConfig } from '@netflex/config';
import type { DefaultAdapterRegistry, PaymentEngine } from '@netflex/core';
import type { PrismaClient } from '@netflex/database';
import { FakePaymentProvider, type PaymentProvider } from '@netflex/payments';
import type { Response } from 'express';
import { z } from 'zod';
import { Public, SkipCsrf } from '../auth/decorators.js';
import { OTP_SENDER, FakeOtpSender, type OtpSender } from '../auth/otp-sender.js';
import { ApiError } from '../common/api-error.js';
import { ZodPipe, phoneE164 } from '../common/zod.js';
import {
  ADAPTER_REGISTRY,
  CONFIG,
  PAYMENT_ENGINE,
  PAYMENT_PROVIDER,
  PRISMA,
} from '../infra/tokens.js';

const notAvailable = () => new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found.');
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * DEVELOPMENT/TEST SIMULATORS ONLY. Lets the full journey be clicked through
 * without real hardware or real money. Registered only when a test-only provider
 * is active; configuration refuses those providers in staging/production, and
 * every handler re-checks the environment. Nothing here touches a real network
 * or a real payment.
 */
@Public()
@ApiExcludeController()
@Controller({ path: 'dev' })
export class DevSimulatorController {
  constructor(
    @Inject(CONFIG) private readonly config: NetflexConfig,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(ADAPTER_REGISTRY) private readonly registry: DefaultAdapterRegistry,
    @Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider,
    @Inject(PAYMENT_ENGINE) private readonly engine: PaymentEngine,
    @Inject(OTP_SENDER) private readonly otp: OtpSender,
  ) {
    assertSimulatorAllowed(config.NETFLEX_ENV, 'DevSimulatorController');
  }

  /** Simulates a phone joining the Wi-Fi: the simulated gateway assigns an IP and redirects to the portal. */
  @Get('fake-gateway/join')
  async join(@Query('gw') gw: string | undefined, @Res() res: Response) {
    const fake = this.registry.fake;
    if (!fake) throw notAvailable();
    const gateway = gw
      ? await this.prisma.gateway.findFirst({ where: { id: gw, vendor: 'FAKE' } })
      : await this.prisma.gateway.findFirst({
          where: { vendor: 'FAKE', status: { not: 'DISABLED' } },
          orderBy: { createdAt: 'asc' },
        });
    if (!gateway) throw notAvailable();
    const mac = Array.from(randomBytes(6), (b, i) =>
      (i === 0 ? (b & 0xfc) | 0x02 : b).toString(16).padStart(2, '0'),
    ).join(':');
    const c = fake.joinClient(mac);
    const url = new URL('/connect', this.config.PUBLIC_WEB_URL);
    url.searchParams.set('gw', gateway.id);
    url.searchParams.set('ip', c.ip);
    url.searchParams.set('mac', c.macAddress);
    res.redirect(302, url.toString());
  }

  /** Simulated hosted checkout page (stands in for checkout.paystack.com). */
  @Get('fake-checkout/:reference')
  async checkoutPage(@Param('reference') reference: string, @Res() res: Response) {
    const fake = this.payments instanceof FakePaymentProvider ? this.payments : null;
    if (!fake || !fake.has(reference)) throw notAvailable();
    const p = await this.prisma.payment.findFirst({
      where: { providerReference: reference },
      select: { amountMinor: true, currency: true },
    });
    const amount = p ? `${p.currency} ${(Number(p.amountMinor) / 100).toFixed(2)}` : '';
    res.type('html')
      .send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Simulated checkout</title><body style="font-family:system-ui;max-width:28rem;margin:2rem auto;padding:0 1rem;line-height:1.5">
<p style="background:#8a5300;color:#fff;padding:.5rem .75rem">SIMULATED PAYMENT — development only. No money moves.</p>
<h1 style="font-size:1.4rem">Pay ${escape(amount)}</h1><p>Reference ${escape(reference)}</p>
<form method="post"><button name="outcome" value="success" style="min-height:44px;padding:0 1rem">Pay (simulate success)</button>
<button name="outcome" value="failed" style="min-height:44px;padding:0 1rem">Simulate failure</button>
<button name="outcome" value="abandoned" style="min-height:44px;padding:0 1rem">Cancel</button></form></body></html>`);
  }

  @SkipCsrf()
  @Post('fake-checkout/:reference')
  async checkoutSubmit(
    @Param('reference') reference: string,
    @Body() body: { outcome?: string },
    @Res() res: Response,
  ) {
    const fake = this.payments instanceof FakePaymentProvider ? this.payments : null;
    if (!fake || !fake.has(reference)) throw notAvailable();
    const outcome =
      body.outcome === 'success' || body.outcome === 'failed' ? body.outcome : 'abandoned';
    fake.complete(reference, { status: outcome });
    const p = await this.prisma.payment.findFirst({ where: { providerReference: reference } });
    if (p && outcome !== 'abandoned') await this.engine.settle(p.id, 'webhook:dev-simulator');
    const url = new URL('/checkout/return', this.config.PUBLIC_WEB_URL);
    if (p) url.searchParams.set('order', p.orderId);
    res.redirect(303, url.toString());
  }

  /** Read the last simulated SMS code for a phone (the simulated SMS inbox). */
  @Post('otp-outbox')
  @HttpCode(200)
  outbox(@Body(new ZodPipe(z.strictObject({ phone: phoneE164 }))) body: { phone: string }) {
    if (!(this.otp instanceof FakeOtpSender)) throw notAvailable();
    return { code: this.otp.lastCode(body.phone) ?? null, simulated: true };
  }
}
