import { loadConfig, type NetflexConfig } from '@netflex/config';

/** Config for integration tests: real local PostgreSQL (netflex_test) and Redis, fakes allowed. */
export function testConfig(overrides: Record<string, string> = {}): NetflexConfig {
  return loadConfig({
    NETFLEX_ENV: 'test',
    LOG_LEVEL: 'fatal',
    DATABASE_URL:
      process.env.TEST_DATABASE_URL ??
      'postgresql://netflex:netflex-dev-only@localhost:54329/netflex_test',
    REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:63799/1',
    PUBLIC_WEB_URL: 'http://localhost:3000',
    PUBLIC_API_URL: 'http://localhost:4000',
    VOUCHER_PEPPER: 'test-pepper-'.padEnd(40, 'x'),
    AUTH_SECRET: 'test-auth-secret-'.padEnd(40, 'y'),
    PAYMENT_PROVIDER: 'fake',
    ...overrides,
  });
}
