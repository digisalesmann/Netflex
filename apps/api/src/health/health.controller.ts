import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import type { PrismaClient } from '@netflex/database';
import type { Response } from 'express';
import type { Redis } from 'ioredis';
import { Public } from '../auth/decorators.js';
import { PRISMA, REDIS } from '../infra/tokens.js';

export const WORKER_HEARTBEAT_KEY = 'netflex:worker:heartbeat';
const CHECK_TIMEOUT_MS = 2_000;
const HEARTBEAT_STALE_MS = 45_000;

type CheckStatus = 'ok' | 'fail';

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Liveness: the process is up. Readiness: it can serve traffic (database and
 * Redis reachable). Worker heartbeat is reported but does not fail API readiness,
 * because the API must keep accepting webhooks while the worker restarts.
 * Responses contain no hostnames, versions, or error text.
 */
@Public()
@ApiTags('health')
@Controller({ path: 'health' })
export class HealthController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get('live')
  @ApiOkResponse({ description: 'Process is running' })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOkResponse({ description: 'Dependencies reachable' })
  @ApiServiceUnavailableResponse({ description: 'A required dependency is unreachable' })
  async ready(@Res({ passthrough: true }) res: Response) {
    const [database, redis, heartbeat] = await Promise.all([
      withTimeout(this.prisma.$queryRaw`SELECT 1`, CHECK_TIMEOUT_MS).then(
        (): CheckStatus => 'ok',
        (): CheckStatus => 'fail',
      ),
      withTimeout(this.redis.ping(), CHECK_TIMEOUT_MS).then(
        (r): CheckStatus => (r === 'PONG' ? 'ok' : 'fail'),
        (): CheckStatus => 'fail',
      ),
      withTimeout(this.redis.get(WORKER_HEARTBEAT_KEY), CHECK_TIMEOUT_MS).catch(() => null),
    ]);

    const lastBeat = heartbeat ? Date.parse(heartbeat) : NaN;
    const worker = Number.isNaN(lastBeat)
      ? 'unknown'
      : Date.now() - lastBeat <= HEARTBEAT_STALE_MS
        ? 'ok'
        : 'stale';

    const ready = database === 'ok' && redis === 'ok';
    res.status(ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: ready ? 'ready' : 'not_ready',
      checks: { database, redis, worker },
      ...(Number.isNaN(lastBeat)
        ? {}
        : { workerLastHeartbeatAt: new Date(lastBeat).toISOString() }),
    };
  }
}
