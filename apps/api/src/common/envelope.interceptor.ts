import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import type { DataEnvelope } from './api-error.js';

/** Wraps successful handler results as { data }. Handlers may return a full envelope to add meta. */
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<DataEnvelope<unknown>> {
    return next
      .handle()
      .pipe(
        map((value: unknown) =>
          value !== null && typeof value === 'object' && 'data' in value
            ? (value as DataEnvelope<unknown>)
            : { data: value ?? null },
        ),
      );
  }
}
