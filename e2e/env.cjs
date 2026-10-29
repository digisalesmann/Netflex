// Environment for the end-to-end stack. TEST-ONLY providers everywhere
// (simulated payments, SMS and gateway); never used outside development/test.
const WEB = 'http://localhost:3100';
const E2E = {
  NETFLEX_ENV: 'development',
  LOG_LEVEL: 'warn',
  DATABASE_URL:
    process.env.E2E_DATABASE_URL ??
    'postgresql://netflex:netflex-dev-only@localhost:54329/netflex_test?schema=e2e',
  REDIS_URL: process.env.E2E_REDIS_URL ?? 'redis://localhost:63799/2',
  API_PORT: '4100',
  PUBLIC_WEB_URL: WEB,
  // Browsers reach the API through the web app's /api proxy (same origin).
  PUBLIC_API_URL: WEB,
  TRUST_PROXY: 'loopback',
  VOUCHER_PEPPER: 'e2e-voucher-pepper-0123456789abcdef0123',
  AUTH_SECRET: 'e2e-auth-secret-0123456789abcdef0123456',
  PAYMENT_PROVIDER: 'fake',
  OTP_PROVIDER: 'fake',
  NETWORK_ADAPTER: 'fake',
  PAID_ACCESS_ENABLED: 'true',
  NETFLEX_PROPERTY_SLUG: 'e2e-lodge',
  API_INTERNAL_URL: 'http://localhost:4100',
  NEXT_TELEMETRY_DISABLED: '1',
};
module.exports = { E2E, WEB };
