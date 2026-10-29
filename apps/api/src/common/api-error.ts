import { HttpStatus } from '@nestjs/common';

/** Stable API error codes. Clients branch on these, never on messages. */
export const API_ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'UNPROCESSABLE',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number] | `DOMAIN_${string}`;

/** Throw from services for expected failures. `message` must be safe to show customers. */
export class ApiError extends Error {
  constructor(
    public readonly status: HttpStatus,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ErrorEnvelope {
  error: {
    code: ApiErrorCode;
    message: string;
    requestId: string;
    details?: Record<string, unknown>;
  };
}

export interface DataEnvelope<T> {
  data: T;
  meta?: Record<string, unknown>;
}
