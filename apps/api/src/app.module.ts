import { Module, type DynamicModule } from '@nestjs/common';
import type { NetflexConfig } from '@netflex/config';
import { CORRELATION_HEADER, loggerOptions, resolveCorrelationId } from '@netflex/observability';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { LoggerModule } from 'nestjs-pino';
import { HealthController } from './health/health.controller.js';
import { InfraModule } from './infra/infra.module.js';

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
      controllers: [HealthController],
    };
  }
}
