import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { NetflexConfig } from '@netflex/config';
import { CORRELATION_HEADER, loggerOptions, resolveCorrelationId } from '@netflex/observability';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { LoggerModule } from 'nestjs-pino';
import { AdminAccessController, MyAccessController } from './access/access.controllers.js';
import { LifecycleService } from './access/lifecycle.service.js';
import { AuditController } from './audit/audit.controller.js';
import { AuditService } from './audit/audit.service.js';
import { AuthController } from './auth/auth.controller.js';
import { CatalogController } from './catalog/catalog.controller.js';
import { PlansController } from './catalog/plans.controller.js';
import { IdempotencyService } from './common/idempotency.service.js';
import { OrdersController } from './orders/orders.controller.js';
import { OrdersService } from './orders/orders.service.js';
import { AccessService } from './vouchers/access.service.js';
import { PaymentEngine } from '@netflex/core';
import { FakePaymentProvider, PaystackProvider, type PaymentProvider } from '@netflex/payments';
import { AdminPaymentsController } from './payments/admin-payments.controller.js';
import { PaymentsService, deliveryKey } from './payments/payments.service.js';
import { WebhooksController } from './payments/webhooks.controller.js';
import { PAYMENT_ENGINE, PAYMENT_PROVIDER, PRISMA } from './infra/tokens.js';
import type { PrismaClient } from '@netflex/database';
import { RedemptionService } from './vouchers/redemption.service.js';
import { VouchersController } from './vouchers/vouchers.controller.js';
import { AuthService } from './auth/auth.service.js';
import { AuthGuard, CsrfGuard } from './auth/guards.js';
import { MeController } from './auth/me.controller.js';
import { FakeOtpSender, OTP_SENDER, UnconfiguredOtpSender } from './auth/otp-sender.js';
import { SessionService } from './auth/session.service.js';
import { HealthController } from './health/health.controller.js';
import { InfraModule } from './infra/infra.module.js';
import { RateLimitService } from './infra/rate-limit.service.js';
import { PropertiesController } from './properties/properties.controller.js';
import { StaffController } from './staff/staff.controller.js';
import { TenancyController } from './tenancy/tenancy.controller.js';
import { TenancyService } from './tenancy/tenancy.service.js';

@Module({})
export class AppModule {
  static forRoot(config: NetflexConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            ...loggerOptions({
              service: 'api',
              environment: config.NETFLEX_ENV,
              level: config.LOG_LEVEL,
            }),
            genReqId: (req: IncomingMessage, res: ServerResponse) => {
              const id = resolveCorrelationId(req.headers[CORRELATION_HEADER]);
              res.setHeader(CORRELATION_HEADER, id);
              return id;
            },
            // Log method + path only: query strings are dropped so nothing sensitive can leak via URLs.
            serializers: {
              req: (req: { id?: unknown; method?: string; url?: string }) => ({
                requestId: req.id,
                method: req.method,
                path: (req.url ?? '').split('?')[0],
              }),
              res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
            },
            autoLogging: {
              ignore: (req: IncomingMessage) => (req.url ?? '').startsWith('/api/v1/health'),
            },
          },
        }),
        InfraModule.forRoot(config),
      ],
      controllers: [
        HealthController,
        AuthController,
        MeController,
        PropertiesController,
        TenancyController,
        StaffController,
        AuditController,
        PlansController,
        CatalogController,
        OrdersController,
        VouchersController,
        WebhooksController,
        AdminPaymentsController,
        AdminAccessController,
        MyAccessController,
      ],
      providers: [
        AuditService,
        RateLimitService,
        SessionService,
        AuthService,
        TenancyService,
        IdempotencyService,
        OrdersService,
        AccessService,
        RedemptionService,
        PaymentsService,
        LifecycleService,
        {
          provide: PAYMENT_PROVIDER,
          useFactory: (): PaymentProvider =>
            config.PAYMENT_PROVIDER === 'paystack'
              ? new PaystackProvider(config.PAYSTACK_SECRET_KEY as string, config.PAYSTACK_BASE_URL)
              : new FakePaymentProvider(config.NETFLEX_ENV),
        },
        {
          provide: PAYMENT_ENGINE,
          inject: [PRISMA, PAYMENT_PROVIDER],
          useFactory: (prisma: PrismaClient, provider: PaymentProvider) =>
            new PaymentEngine(prisma, provider, {
              voucher: {
                pepper: config.VOUCHER_PEPPER,
                pepperVersion: config.VOUCHER_PEPPER_VERSION,
              },
              deliveryKey: deliveryKey(config),
            }),
        },
        {
          provide: OTP_SENDER,
          useFactory: () =>
            config.OTP_PROVIDER === 'fake'
              ? new FakeOtpSender(config.NETFLEX_ENV)
              : new UnconfiguredOtpSender(),
        },
        // Order matters: CSRF check runs before authentication.
        { provide: APP_GUARD, useClass: CsrfGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    };
  }
}
