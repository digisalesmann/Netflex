import {
  Global,
  Inject,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { NetflexConfig } from '@netflex/config';
import { createPrismaClient, type PrismaClient } from '@netflex/database';
import { Redis } from 'ioredis';
import { Logger } from 'nestjs-pino';
import { CONFIG, PRISMA, REDIS } from './tokens.js';

@Global()
@Module({})
export class InfraModule implements OnApplicationShutdown {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  static forRoot(config: NetflexConfig): DynamicModule {
    return {
      module: InfraModule,
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: PRISMA, useFactory: () => createPrismaClient(config.DATABASE_URL) },
        {
          provide: REDIS,
          inject: [Logger],
          useFactory: (logger: Logger) => {
            // Commands queue briefly while (re)connecting, but never wait more than 2s:
            // callers such as the rate limiter then fail closed instead of hanging.
            const redis = new Redis(config.REDIS_URL, {
              maxRetriesPerRequest: 1,
              commandTimeout: 2_000,
              connectTimeout: 5_000,
            });
            // Without a listener ioredis would crash the process on connection errors.
            redis.on('error', (err: Error) =>
              logger.warn({ err: err.message }, 'redis connection error'),
            );
            return redis;
          },
        },
      ],
      exports: [CONFIG, PRISMA, REDIS],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.prisma.$disconnect(), this.redis.quit()]);
  }
}
