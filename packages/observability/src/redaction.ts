/**
 * Field names whose values must never reach logs (spec §24, §25): voucher codes,
 * OTPs, session tokens, cookies, passwords, payment and router secrets.
 */
export const SENSITIVE_KEYS = [
  'authorization',
  'cookie',
  'set-cookie',
  'password',
  'passwordHash',
  'mfaSecret',
  'mfaSecretEnc',
  'token',
  'sessionToken',
  'secret',
  'secretKey',
  'apiKey',
  'code',
  'voucher',
  'voucherCode',
  'otp',
  'otpCode',
  'pepper',
  'VOUCHER_PEPPER',
  'AUTH_SECRET',
  'PAYSTACK_SECRET_KEY',
  'DATABASE_URL',
  'REDIS_URL',
  'x-paystack-signature',
] as const;

export const REDACTED = '[REDACTED]';

/**
 * pino redact paths. pino wildcards match one level, so each key is listed at the
 * top level and up to two levels deep, plus the HTTP request/response headers.
 */
export function redactPaths(): string[] {
  const paths = new Set<string>();
  for (const key of SENSITIVE_KEYS) {
    const k = /^[A-Za-z_$][\w$]*$/.test(key) ? key : `["${key}"]`;
    const join = (prefix: string) => (k.startsWith('[') ? `${prefix}${k}` : `${prefix}.${k}`);
    if (!k.startsWith('[')) paths.add(k);
    paths.add(join('*'));
    paths.add(join('*.*'));
    paths.add(join('req.headers'));
    paths.add(join('res.headers'));
  }
  return [...paths];
}
