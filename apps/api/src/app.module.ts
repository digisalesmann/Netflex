import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { NetflexConfig } from '@netflex/config';
import { CORRELATION_HEADER, loggerOptions, resolveCorrelationId } from '@netflex/observability';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { LoggerModule } from 'nestjs-pino';
import { AuditController } from './audit/audit.controller.js';
import { AuditService } from './audit/audit.service.js';
import { AuthController } from './auth/auth.controller.js';
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
      ],
      providers: [
        AuditService,
        RateLimitService,
        SessionService,
        AuthService,
        TenancyService,
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
