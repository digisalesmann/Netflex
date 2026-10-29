import {
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { DomainError } from '@netflex/domain';
import type { Request, Response } from 'express';
import type { PinoLogger } from 'nestjs-pino';
import { ApiError, type ApiErrorCode, type ErrorEnvelope } from './api-error.js';

const STATUS_CODES: Partial<Record<number, ApiErrorCode>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'UNPROCESSABLE',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

const SAFE_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  BAD_REQUEST: 'The request could not be processed.',
  UNAUTHENTICATED: 'Please sign in to continue.',
  FORBIDDEN: 'You do not have access to this.',
  NOT_FOUND: 'Not found.',
  CONFLICT: 'This conflicts with the current state. Refresh and try again.',
  PAYLOAD_TOO_LARGE: 'The request is too large.',
  RATE_LIMITED: 'Too many attempts. Please wait and try again.',
  SERVICE_UNAVAILABLE: 'Service temporarily unavailable. Please try again shortly.',
  INTERNAL_ERROR: 'Something went wrong on our side. Please try again.',
};

function isBodyParserError(e: unknown): e is Error & { status: number; type: string } {
  if (!(e instanceof Error)) return false;
  const { status, type } = e as Error & { status?: unknown; type?: unknown };
  return (
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    typeof type === 'string' &&
    type.startsWith('entity.')
  );
}

/**
 * Converts every error into the standard envelope. Customers never see stack
 * traces or internal messages; unexpected errors are logged with the request ID.
 */
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request & { id?: string }>();
    const res = http.getResponse<Response>();
    const requestId = String(req.id ?? '');

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ApiErrorCode = 'INTERNAL_ERROR';
    let message = SAFE_MESSAGES.INTERNAL_ERROR as string;
    let details: Record<string, unknown> | undefined;

    if (exception instanceof ApiError) {
      status = exception.status;
      code = exception.code;
      message = exception.message;
      details = exception.details ? { ...exception.details } : undefined;
    } else if (exception instanceof DomainError) {
      status = HttpStatus.UNPROCESSABLE_ENTITY;
      code = `DOMAIN_${exception.code}`;
      message = 'This action is not allowed in the current state.';
      this.logger.info(
        { requestId, code: exception.code, details: exception.details },
        'domain rule rejected request',
      );
    } else if (isBodyParserError(exception)) {
      // express body-parser errors (too large, malformed JSON) are client errors, not 500s.
      status = exception.status;
      code = STATUS_CODES[status] ?? 'BAD_REQUEST';
      message = SAFE_MESSAGES[code] ?? 'The request could not be processed.';
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = STATUS_CODES[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST');
      message = SAFE_MESSAGES[code] ?? 'The request could not be processed.';
    }

    if (status >= 500) {
      const err =
        exception instanceof Error
          ? { name: exception.name, message: exception.message, stack: exception.stack }
          : { value: String(exception) };
      this.logger.error({ requestId, err }, 'unhandled error');
    }

    const body: ErrorEnvelope = {
      error: { code, message, requestId, ...(details ? { details } : {}) },
    };
    res.status(status).json(body);
  }
}
