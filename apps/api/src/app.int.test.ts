import type { NestExpressApplication } from '@nestjs/platform-express';
import { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testConfig } from '../../../scripts/test/test-config.js';
import { createApp } from './app.factory.js';
import { WORKER_HEARTBEAT_KEY } from './health/health.controller.js';

let app: NestExpressApplication;
let redis: Redis;
const config = testConfig();

beforeAll(async () => {
  app = await createApp(config);
  await app.init();
  redis = new Redis(config.REDIS_URL);
});

afterAll(async () => {
  await redis.quit();
  await app.close();
});

describe('health', () => {
  it('live returns the data envelope', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    expect(res.body).toEqual({ data: { status: 'ok' } });
  });

  it('ready checks the real database and Redis', async () => {
    await redis.del(WORKER_HEARTBEAT_KEY);
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
    expect(res.body.data).toEqual({
      status: 'ready',
      checks: { database: 'ok', redis: 'ok', worker: 'unknown' },
    });
  });

  it('reports a fresh worker heartbeat and flags a stale one', async () => {
    await redis.set(WORKER_HEARTBEAT_KEY, new Date().toISOString());
    let res = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
    expect(res.body.data.checks.worker).toBe('ok');
    await redis.set(WORKER_HEARTBEAT_KEY, new Date(Date.now() - 120_000).toISOString());
    res = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
    expect(res.body.data.checks.worker).toBe('stale');
    await redis.del(WORKER_HEARTBEAT_KEY);
  });
});

describe('correlation IDs', () => {
  it('echoes a safe incoming request id', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('x-request-id', 'client-req-0001');
    expect(res.headers['x-request-id']).toBe('client-req-0001');
  });

  it('replaces an unsafe request id', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('x-request-id', '<script>x</script>');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('errors and security headers', () => {
  it('returns a stable error envelope with request id for unknown routes', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nope').expect(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Not found.', requestId: res.headers['x-request-id'] },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/stack|Cannot GET|node_modules/);
  });

  it('rejects oversized bodies without leaking internals', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/health/live')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ x: 'a'.repeat(200_000) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects malformed JSON as a 400, not a 500', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/health/live')
      .set('content-type', 'application/json')
      .send('{"broken":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/live');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['strict-transport-security']).toBeDefined();
  });

  it('only allows CORS from the configured web origin', async () => {
    const ok = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('origin', 'http://localhost:3000');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    const bad = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('origin', 'https://evil.example');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('OpenAPI', () => {
  it('serves the document outside production', async () => {
    const res = await request(app.getHttpServer()).get('/api/docs/openapi.json').expect(200);
    expect(res.body.paths).toHaveProperty('/api/v1/health/ready');
  });

  it('is not served in production', async () => {
    const prod = await createApp(
      testConfig({
        NETFLEX_ENV: 'production',
        PAYMENT_PROVIDER: 'paystack',
        PAYSTACK_SECRET_KEY: 'sk_live_placeholder',
        PUBLIC_WEB_URL: 'https://netflex.example',
        PUBLIC_API_URL: 'https://api.netflex.example',
      }),
    );
    await prod.init();
    await request(prod.getHttpServer()).get('/api/docs/openapi.json').expect(404);
    await prod.close();
  });
});
