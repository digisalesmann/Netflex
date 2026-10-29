import 'reflect-metadata';
import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NetflexConfig } from '@netflex/config';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger, PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { EnvelopeInterceptor } from './common/envelope.interceptor.js';
import { AllExceptionsFilter } from './common/exception.filter.js';

export const API_PREFIX = 'api';

/** Builds the configured Nest application. Shared by main.ts and API tests. */
export async function createApp(config: NetflexConfig): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    bufferLogs: true,
    // Raw body is kept for payment webhook signature verification (spec §13.3).
    rawBody: true,
  });
  app.useLogger(app.get(Logger));
  app.disable('x-powered-by');
  // Money and audit ids are BigInt; serialize them as decimal strings, never as floats.
  app.set('json replacer', (_key: string, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
  const tp = config.TRUST_PROXY;
  app.set(
    'trust proxy',
    tp === 'false' ? false : /^\d+$/.test(tp) ? Number(tp) : tp.split(',').map((x) => x.trim()),
  );
  app.useBodyParser('json', { limit: '100kb' });
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: [config.PUBLIC_WEB_URL],
    credentials: true,
    allowedHeaders: ['content-type', 'x-netflex-csrf', 'x-request-id', 'idempotency-key'],
  });
  app.setGlobalPrefix(API_PREFIX);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter(await app.resolve(PinoLogger)));
  app.enableShutdownHooks();

  if (config.NETFLEX_ENV !== 'production') {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('NetFlex API')
        .setDescription(
          'Versioned REST API. Responses use { data } or { error: { code, message, requestId } }.',
        )
        .setVersion('1')
        .build(),
    );
    SwaggerModule.setup(`${API_PREFIX}/docs`, app, doc, {
      jsonDocumentUrl: `${API_PREFIX}/docs/openapi.json`,
    });
  }
  return app;
}
