import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  randomInt,
} from 'node:crypto';

/** Derive a purpose-specific 32-byte key from the master secret (HKDF-SHA256). */
export function deriveKey(masterSecret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', masterSecret, 'netflex', `netflex:${purpose}`, 32));
}

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext> (base64url). Used for MFA secrets at rest. */
export function encryptSecret(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ct.toString('base64url'),
  ].join('.');
}

export function decryptSecret(key: Buffer, encoded: string): string {
  const [v, iv, tag, ct] = encoded.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('invalid ciphertext format');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString(
    'utf8',
  );
}

/** Opaque random token for session cookies (256 bits). */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Keyed verifier stored instead of tokens/OTP codes. 64 hex chars. */
export function keyedVerifier(key: Buffer, value: string): string {
  return createHmac('sha256', key).update(value).digest('hex');
}

/** Uniform 6-digit numeric one-time code. */
export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}
