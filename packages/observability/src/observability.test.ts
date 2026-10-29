import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, resolveCorrelationId } from './index.js';

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      cb();
    },
  });
  const log = createLogger({ service: 'api', environment: 'test', level: 'info' }, stream);
  return { log, lines };
}

describe('logger redaction', () => {
  it('redacts secrets at top level and nested', () => {
    const { log, lines } = capture();
    log.info(
      {
        code: 'ABCD-EFGH-JKMN',
        voucherCode: 'ABCDEFGHJKMN',
        body: { otp: '123456', password: 'hunter2', nested: { token: 'tok_123' } },
        req: {
          headers: { authorization: 'Bearer x', cookie: 'sid=1', 'x-paystack-signature': 'sig' },
        },
        config: { PAYSTACK_SECRET_KEY: 'sk_test_123', DATABASE_URL: 'postgresql://u:p@h/db' },
        safe: 'visible',
      },
      'event',
    );
    const out = JSON.stringify(lines[0]);
    for (const secret of [
      'ABCD-EFGH-JKMN',
      'ABCDEFGHJKMN',
      '123456',
      'hunter2',
      'tok_123',
      'Bearer x',
      'sid=1',
      'sig"',
      'sk_test_123',
      'u:p@h',
    ]) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('visible');
    expect(out).toContain('[REDACTED]');
  });

  it('emits structured JSON with service, env, level label and ISO time', () => {
    const { log, lines } = capture();
    log.warn({ orderId: 'o1' }, 'hello');
    expect(lines[0]).toMatchObject({
      service: 'api',
      env: 'test',
      level: 'warn',
      msg: 'hello',
      orderId: 'o1',
    });
    expect(String(lines[0]?.time)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('resolveCorrelationId', () => {
  it('keeps a safe incoming id', () => {
    expect(resolveCorrelationId('req-12345678')).toBe('req-12345678');
    expect(resolveCorrelationId(['abc12345-x'])).toBe('abc12345-x');
  });
  it.each([
    undefined,
    '',
    'short',
    'a'.repeat(65),
    'bad id with spaces',
    '<script>alert(1)</script>',
    'line\nbreak12',
  ])('replaces unsafe id %j', (bad) => {
    const id = resolveCorrelationId(bad);
    expect(id).not.toBe(bad);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
