import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  decryptSecret,
  deriveKey,
  encryptSecret,
  generateOtpCode,
  generateToken,
  generateTotpSecret,
  hashPassword,
  hotp,
  keyedVerifier,
  needsRehash,
  otpauthUri,
  passwordProblems,
  totpAt,
  verifyPassword,
  verifyTotp,
} from './index.js';

describe('password hashing (scrypt)', () => {
  it('verifies the right password and rejects others', async () => {
    const h = await hashPassword('correct horse battery staple', { logN: 14 });
    expect(h).toMatch(/^scrypt\$14\$8\$1\$/);
    expect(await verifyPassword('correct horse battery staple', h)).toBe(true);
    expect(await verifyPassword('correct horse battery stapl', h)).toBe(false);
    expect(await verifyPassword('anything', 'garbage')).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same-password-123', { logN: 12 })).not.toBe(
      await hashPassword('same-password-123', { logN: 12 }),
    );
  });

  it('flags weak parameters for rehash', async () => {
    expect(needsRehash(await hashPassword('x'.repeat(12), { logN: 12 }))).toBe(true);
  });

  it('uses OWASP-level cost by default', async () => {
    const h = await hashPassword('a-strong-password-here');
    expect(h.startsWith('scrypt$17$')).toBe(true);
    expect(needsRehash(h)).toBe(false);
  }, 20_000);

  it('password policy', () => {
    expect(passwordProblems('short')).toContain('must be at least 12 characters');
    expect(passwordProblems('aaaaaaaaaaaaaaa')).toContain(
      'must not be a single repeated character',
    );
    expect(passwordProblems('ada-lovelace-2026', ['lovelace'])).toContain(
      'must not contain your name or email',
    );
    expect(passwordProblems('a sensible long passphrase')).toEqual([]);
  });
});

describe('TOTP (RFC 6238 / RFC 4226 test vectors)', () => {
  const rfcSecret = Buffer.from('12345678901234567890');
  const b32 = base32Encode(rfcSecret);

  it('base32 round-trips', () => {
    expect(b32).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(b32).equals(rfcSecret)).toBe(true);
  });

  it('matches RFC 4226 HOTP values', () => {
    const expected = ['755224', '287082', '359152', '969429', '338314'];
    expected.forEach((code, counter) => expect(hotp(rfcSecret, counter)).toBe(code));
  });

  it('matches RFC 6238 SHA-1 values (8 digits)', () => {
    expect(totpAt(b32, 59, 8)).toBe('94287082');
    expect(totpAt(b32, 1111111109, 8)).toBe('07081804');
    expect(totpAt(b32, 1234567890, 8)).toBe('89005924');
    expect(totpAt(b32, 20000000000, 8)).toBe('65353130');
  });

  it('accepts ±1 step and rejects further drift', () => {
    const now = 1_800_000_000;
    expect(verifyTotp(b32, totpAt(b32, now - 30), now).ok).toBe(true);
    expect(verifyTotp(b32, totpAt(b32, now + 30), now).ok).toBe(true);
    expect(verifyTotp(b32, totpAt(b32, now - 90), now).ok).toBe(false);
  });

  it('rejects replay of the same or an earlier step', () => {
    const now = 1_800_000_000;
    const code = totpAt(b32, now);
    const first = verifyTotp(b32, code, now);
    expect(first.ok).toBe(true);
    const step = first.ok ? first.step : -1;
    expect(verifyTotp(b32, code, now, step).ok).toBe(false);
  });

  it('rejects malformed codes', () => {
    expect(verifyTotp(b32, '12345', 0).ok).toBe(false);
    expect(verifyTotp(b32, 'abcdef', 0).ok).toBe(false);
  });

  it('generates 160-bit secrets and an otpauth URI', () => {
    const s = generateTotpSecret();
    expect(base32Decode(s)).toHaveLength(20);
    expect(otpauthUri(s, 'ada@example.com')).toMatch(
      /^otpauth:\/\/totp\/NetFlex%3Aada%40example\.com\?secret=/,
    );
  });
});

describe('secrets', () => {
  const key = deriveKey('m'.repeat(40), 'mfa');

  it('derives distinct keys per purpose', () => {
    expect(deriveKey('m'.repeat(40), 'mfa').equals(key)).toBe(true);
    expect(deriveKey('m'.repeat(40), 'session').equals(key)).toBe(false);
  });

  it('encrypts and decrypts; tampering is detected', () => {
    const enc = encryptSecret(key, 'JBSWY3DPEHPK3PXP');
    expect(enc).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(key, enc)).toBe('JBSWY3DPEHPK3PXP');
    const parts = enc.split('.');
    const ct = Buffer.from(parts[3] as string, 'base64url');
    ct[0] = (ct[0] as number) ^ 1;
    parts[3] = ct.toString('base64url');
    expect(() => decryptSecret(key, parts.join('.'))).toThrow();
    expect(() => decryptSecret(deriveKey('n'.repeat(40), 'mfa'), enc)).toThrow();
  });

  it('tokens are 256-bit and unique; verifiers are keyed hex', () => {
    const t = generateToken();
    expect(Buffer.from(t, 'base64url')).toHaveLength(32);
    expect(generateToken()).not.toBe(t);
    expect(keyedVerifier(key, t)).toMatch(/^[0-9a-f]{64}$/);
    expect(keyedVerifier(deriveKey('z'.repeat(40), 'x'), t)).not.toBe(keyedVerifier(key, t));
  });

  it('OTP codes are 6 digits', () => {
    for (let i = 0; i < 200; i++) expect(generateOtpCode()).toMatch(/^\d{6}$/);
  });
});
