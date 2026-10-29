import { randomUUID } from 'node:crypto';

export const CORRELATION_HEADER = 'x-request-id';

const SAFE_ID = /^[A-Za-z0-9._:-]{8,64}$/;

/**
 * Accept a caller-supplied request ID only if it is short and plain (so it can't
 * inject into logs or headers); otherwise generate a new one.
 */
export function resolveCorrelationId(incoming: unknown): string {
  const value = Array.isArray(incoming) ? incoming[0] : incoming;
  return typeof value === 'string' && SAFE_ID.test(value) ? value : randomUUID();
}
