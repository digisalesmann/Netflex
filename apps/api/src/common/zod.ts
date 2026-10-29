import { HttpStatus, type PipeTransform } from '@nestjs/common';
import { z } from 'zod';
import { ApiError } from './api-error.js';

/**
 * Validates request bodies/queries with zod. Unknown keys are rejected (prevents
 * mass assignment). Error details list field paths and rules, never echo input.
 */
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}
  transform(value: unknown): z.infer<T> {
    const r = this.schema.safeParse(value);
    if (r.success) return r.data;
    throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Some fields are invalid.', {
      fields: r.error.issues.map((i) => ({ path: i.path.join('.'), rule: i.code })),
    });
  }
}

export const uuid = z.uuid();
export const reason = z.string().trim().min(3).max(500);
/** Nigerian numbers accepted as 0803…, 234803…, +234803…; normalized to E.164. */
export const phoneE164 = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ''))
  .transform((v) =>
    v.startsWith('0') && v.length === 11 ? `+234${v.slice(1)}` : v.startsWith('234') ? `+${v}` : v,
  )
  .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/));
export const email = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const pagination = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.uuid().optional(),
});
