import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Password hashing with scrypt (built into Node; no native add-on).
 * Format: scrypt$<logN>$<r>$<p>$<salt b64url>$<hash b64url>
 * Parameters follow OWASP's scrypt guidance (N=2^17, r=8, p=1).
 */
const DEFAULT = { logN: 17, r: 8, p: 1, keyLen: 32 } as const;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

function scrypt(
  password: string,
  salt: Buffer,
  keyLen: number,
  opts: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize('NFKC'), salt, keyLen, opts, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

const opts = (logN: number, r: number, p: number): ScryptOptions => ({
  N: 2 ** logN,
  r,
  p,
  maxmem: 256 * 2 ** logN * r,
});

export async function hashPassword(
  password: string,
  params: { logN?: number } = {},
): Promise<string> {
  const logN = params.logN ?? DEFAULT.logN;
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, DEFAULT.keyLen, opts(logN, DEFAULT.r, DEFAULT.p));
  return [
    'scrypt',
    logN,
    DEFAULT.r,
    DEFAULT.p,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, logN, r, p, saltB64, hashB64] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const expected = Buffer.from(hashB64, 'base64url');
  const actual = await scrypt(
    password,
    Buffer.from(saltB64, 'base64url'),
    expected.length,
    opts(Number(logN), Number(r), Number(p)),
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** True if the stored hash uses weaker parameters than current defaults (rehash on next login). */
export function needsRehash(stored: string): boolean {
  const logN = Number(stored.split('$')[1]);
  return !(logN >= DEFAULT.logN);
}

/** A hash of a random password, verified against when the account doesn't exist (equalizes timing). */
let dummy: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(24).toString('base64url'));
  return dummy;
}

/** Basic policy: length bounds and not trivially weak. */
export function passwordProblems(password: string, context: string[] = []): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH)
    problems.push(`must be at least ${PASSWORD_MIN_LENGTH} characters`);
  if (password.length > PASSWORD_MAX_LENGTH)
    problems.push(`must be at most ${PASSWORD_MAX_LENGTH} characters`);
  if (/^(.)\1+$/.test(password)) problems.push('must not be a single repeated character');
  const lower = password.toLowerCase();
  for (const c of context) {
    if (c.length >= 4 && lower.includes(c.toLowerCase()))
      problems.push('must not contain your name or email');
  }
  if (['password1234', '123456789012', 'qwertyuiop12', 'netflexnetflex'].includes(lower))
    problems.push('is too common');
  return [...new Set(problems)];
}
