import { z } from 'zod';

export const NETFLEX_ENVIRONMENTS = ['development', 'test', 'staging', 'production'] as const;
export type NetflexEnvironment = (typeof NETFLEX_ENVIRONMENTS)[number];

/** Environments where test doubles (fake payment/network/OTP providers) may be loaded. */
export const SIMULATOR_ENVIRONMENTS: readonly NetflexEnvironment[] = ['development', 'test'];

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const baseSchema = z.object({
  NETFLEX_ENV: z.enum(NETFLEX_ENVIRONMENTS),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().url().startsWith('postgresql://'),
  REDIS_URL: z.string().url().startsWith('redis'),

  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  /**
   * Express "trust proxy": which upstream proxies may set X-Forwarded-For. Needed
   * for correct per-client rate limits behind a load balancer. 'false' (default)
   * ignores the header; 'loopback', a hop count, or a comma-separated CIDR list.
   */
  TRUST_PROXY: z
    .string()
    .regex(/^(false|loopback|\d{1,2}|[0-9a-fA-F.:/,\s]+)$/)
    .default('false'),
  PUBLIC_WEB_URL: z.string().url(),
  PUBLIC_API_URL: z.string().url(),

  /** Keyed verifier secret for voucher codes (ADR-0003). */
  VOUCHER_PEPPER: z.string().min(32),
  VOUCHER_PEPPER_VERSION: z.coerce.number().int().min(1).default(1),
  /** Keyed verifier secret for OTP codes and session tokens. */
  AUTH_SECRET: z.string().min(32),

  PAYMENT_PROVIDER: z.enum(['paystack', 'fake']),
  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYSTACK_BASE_URL: z.string().url().default('https://api.paystack.co'),

  NETWORK_ADAPTER: z.enum(['none', 'fake', 'mikrotik']).default('none'),
  OTP_PROVIDER: z.enum(['none', 'fake']).default('none'),

  /**
   * Master switch for selling paid access. Must stay false until the legal and
   * feasibility gates in docs/legal-feasibility-gates.md are passed.
   */
  PAID_ACCESS_ENABLED: booleanString,
});

export type NetflexConfig = z.infer<typeof baseSchema>;

const envSchema = baseSchema.superRefine((cfg, ctx) => {
  const simulatorsAllowed = SIMULATOR_ENVIRONMENTS.includes(cfg.NETFLEX_ENV);
  const fail = (path: string, message: string) =>
    ctx.addIssue({ code: 'custom', path: [path], message });

  if (!simulatorsAllowed) {
    if (cfg.PAYMENT_PROVIDER === 'fake')
      fail('PAYMENT_PROVIDER', 'fake provider is not allowed here');
    if (cfg.NETWORK_ADAPTER === 'fake') fail('NETWORK_ADAPTER', 'fake adapter is not allowed here');
    if (cfg.OTP_PROVIDER === 'fake') fail('OTP_PROVIDER', 'fake provider is not allowed here');
  }

  if (cfg.PAYMENT_PROVIDER === 'paystack') {
    const key = cfg.PAYSTACK_SECRET_KEY ?? '';
    if (!key) fail('PAYSTACK_SECRET_KEY', 'required when PAYMENT_PROVIDER=paystack');
    else if (cfg.NETFLEX_ENV === 'production' && !key.startsWith('sk_live_'))
      fail('PAYSTACK_SECRET_KEY', 'production requires a live secret key');
    else if (cfg.NETFLEX_ENV !== 'production' && !key.startsWith('sk_test_'))
      fail('PAYSTACK_SECRET_KEY', 'non-production environments must use a test secret key');
  }

  if (cfg.NETFLEX_ENV === 'production') {
    if (!cfg.PUBLIC_WEB_URL.startsWith('https://')) fail('PUBLIC_WEB_URL', 'must use https');
    if (!cfg.PUBLIC_API_URL.startsWith('https://')) fail('PUBLIC_API_URL', 'must use https');
  }
});

export class ConfigError extends Error {
  constructor(public readonly issues: readonly string[]) {
    super(`Invalid NetFlex configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

/**
 * Parse and validate configuration. Fails fast with messages that name the
 * variable and the rule but never echo the value (values may be secrets).
 */
export function loadConfig(
  source: Record<string, string | undefined> = process.env,
): NetflexConfig {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;
  const issues = result.error.issues.map((i) => {
    const key = i.path.join('.') || '(root)';
    const message = i.code === 'custom' ? i.message : describeIssue(i, source);
    return `${key}: ${message}`;
  });
  throw new ConfigError(issues);
}

function describeIssue(
  issue: z.core.$ZodIssue,
  source: Record<string, string | undefined>,
): string {
  const key = issue.path[0];
  switch (issue.code) {
    case 'invalid_type':
      return typeof key === 'string' && source[key] === undefined
        ? 'is required'
        : `must be ${issue.expected}`;
    case 'invalid_value':
      return `must be one of: ${issue.values.map(String).join(', ')}`;
    case 'too_small':
      return `is too short (min ${String(issue.minimum)})`;
    case 'invalid_format':
      return 'has an invalid format';
    default:
      return 'is invalid';
  }
}

/**
 * Guard called by every test double's constructor. Makes it impossible to load a
 * simulator in staging/production even if DI wiring is wrong.
 */
export function assertSimulatorAllowed(env: NetflexEnvironment, simulatorName: string): void {
  if (!SIMULATOR_ENVIRONMENTS.includes(env)) {
    throw new Error(`${simulatorName} is a test double and cannot run in "${env}"`);
  }
}
