import { describe, expect, it } from 'vitest';
import { ConfigError, assertSimulatorAllowed, loadConfig } from './env.js';

const base = {
  NETFLEX_ENV: 'development',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/netflex',
  REDIS_URL: 'redis://localhost:6379',
  PUBLIC_WEB_URL: 'http://localhost:3000',
  PUBLIC_API_URL: 'http://localhost:4000',
  VOUCHER_PEPPER: 'x'.repeat(32),
  AUTH_SECRET: 'y'.repeat(32),
  PAYMENT_PROVIDER: 'fake',
};

const prod = {
  ...base,
  NETFLEX_ENV: 'production',
  PUBLIC_WEB_URL: 'https://netflex.example',
  PUBLIC_API_URL: 'https://api.netflex.example',
  PAYMENT_PROVIDER: 'paystack',
  PAYSTACK_SECRET_KEY: 'sk_live_abc',
};

describe('loadConfig', () => {
  it('accepts a valid development config with safe defaults', () => {
    const cfg = loadConfig(base);
    expect(cfg.NETWORK_ADAPTER).toBe('none');
    expect(cfg.PAID_ACCESS_ENABLED).toBe(false);
    expect(cfg.API_PORT).toBe(4000);
  });

  it('accepts a valid production config', () => {
    expect(() => loadConfig(prod)).not.toThrow();
  });

  it.each([
    ['PAYMENT_PROVIDER', 'fake'],
    ['NETWORK_ADAPTER', 'fake'],
    ['OTP_PROVIDER', 'fake'],
  ])('rejects %s=%s in production', (key, value) => {
    expect(() => loadConfig({ ...prod, [key]: value })).toThrow(ConfigError);
  });

  it('rejects fakes in staging too', () => {
    expect(() =>
      loadConfig({
        ...prod,
        NETFLEX_ENV: 'staging',
        PAYSTACK_SECRET_KEY: 'sk_test_x',
        NETWORK_ADAPTER: 'fake',
      }),
    ).toThrow(/NETWORK_ADAPTER/);
  });

  it('requires live Paystack keys in production and test keys elsewhere', () => {
    expect(() => loadConfig({ ...prod, PAYSTACK_SECRET_KEY: 'sk_test_abc' })).toThrow(
      /live secret key/,
    );
    expect(() =>
      loadConfig({ ...base, PAYMENT_PROVIDER: 'paystack', PAYSTACK_SECRET_KEY: 'sk_live_abc' }),
    ).toThrow(/test secret key/);
  });

  it('refuses the MikroTik adapter until the hardware proof-of-concept', () => {
    expect(() => loadConfig({ ...base, NETWORK_ADAPTER: 'mikrotik' })).toThrow(/proof-of-concept/);
  });

  it('requires https in production', () => {
    expect(() => loadConfig({ ...prod, PUBLIC_WEB_URL: 'http://netflex.example' })).toThrow(
      /https/,
    );
  });

  it('never echoes secret values in errors', () => {
    const secret = 'sk_test_SUPERSECRETVALUE';
    try {
      loadConfig({ ...prod, PAYSTACK_SECRET_KEY: secret, VOUCHER_PEPPER: 'short-secret' });
      expect.fail('should throw');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain(secret);
      expect(msg).not.toContain('short-secret');
      expect(msg).toContain('VOUCHER_PEPPER');
    }
  });

  it('reports missing required variables by name', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL: is required/);
  });
});

describe('assertSimulatorAllowed', () => {
  it('allows development and test', () => {
    expect(() => assertSimulatorAllowed('development', 'Fake')).not.toThrow();
    expect(() => assertSimulatorAllowed('test', 'Fake')).not.toThrow();
  });
  it('refuses staging and production', () => {
    expect(() => assertSimulatorAllowed('staging', 'Fake')).toThrow();
    expect(() => assertSimulatorAllowed('production', 'Fake')).toThrow();
  });
});
