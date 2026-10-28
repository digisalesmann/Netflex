import { DomainError } from './errors.js';

/**
 * Time rules (ADR-0005):
 * - Instants are UTC `Date`s. The property's IANA time zone is used only for
 *   calendar arithmetic (months) and display.
 * - Validity is half-open: access is valid while startsAt <= now < expiresAt.
 */

export const DURATION_UNITS = ['MINUTE', 'HOUR', 'DAY', 'WEEK', 'CALENDAR_MONTH'] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number];

export interface PlanDuration {
  readonly value: number;
  readonly unit: DurationUnit;
}

const MS = { MINUTE: 60_000, HOUR: 3_600_000, DAY: 86_400_000, WEEK: 604_800_000 } as const;
const MAX_VALUE: Record<DurationUnit, number> = {
  MINUTE: 60 * 24 * 31,
  HOUR: 24 * 366,
  DAY: 366,
  WEEK: 53,
  CALENDAR_MONTH: 12,
};

export function assertValidDuration(d: PlanDuration): void {
  if (!Number.isInteger(d.value) || d.value < 1 || d.value > MAX_VALUE[d.unit]) {
    throw new DomainError(
      'INVALID_DURATION',
      'Duration must be a positive whole number within limits',
      {
        unit: d.unit,
        value: d.value,
      },
    );
  }
}

export function assertValidTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw new DomainError('INVALID_TIME_ZONE', 'Unknown IANA time zone', { timeZone });
  }
}

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    assertValidTimeZone(timeZone);
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

export function toZonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = formatter(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
    millisecond: instant.getUTCMilliseconds(),
  };
}

function offsetMs(instant: Date, timeZone: string): number {
  const p = toZonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, p.millisecond);
  return asUtc - instant.getTime();
}

/**
 * Convert local wall-clock parts in `timeZone` to a UTC instant. For local times
 * that don't exist (DST spring-forward gap) the later valid instant is chosen;
 * for ambiguous times (fall-back) the earlier offset is chosen.
 */
export function fromZonedParts(p: ZonedParts, timeZone: string): Date {
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, p.millisecond);
  const firstOffset = offsetMs(new Date(wall), timeZone);
  let result = wall - firstOffset;
  const secondOffset = offsetMs(new Date(result), timeZone);
  if (secondOffset !== firstOffset) result = wall - secondOffset;
  return new Date(result);
}

function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/** Add calendar months in local time, clamping to the end of shorter months. */
export function addCalendarMonths(instant: Date, months: number, timeZone: string): Date {
  const p = toZonedParts(instant, timeZone);
  const total = p.year * 12 + (p.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const day = Math.min(p.day, daysInMonth(year, month));
  return fromZonedParts({ ...p, year, month, day }, timeZone);
}

export function addDuration(start: Date, duration: PlanDuration, timeZone: string): Date {
  assertValidDuration(duration);
  if (duration.unit === 'CALENDAR_MONTH') return addCalendarMonths(start, duration.value, timeZone);
  return new Date(start.getTime() + MS[duration.unit] * duration.value);
}

/** Half-open validity check: startsAt <= now < expiresAt. */
export function isWithinValidity(now: Date, startsAt: Date, expiresAt: Date): boolean {
  const t = now.getTime();
  return startsAt.getTime() <= t && t < expiresAt.getTime();
}

export function hasExpired(now: Date, expiresAt: Date): boolean {
  return now.getTime() >= expiresAt.getTime();
}

/** Whole seconds remaining, floored, never negative. Suitable for RADIUS Session-Timeout. */
export function remainingSeconds(now: Date, expiresAt: Date): number {
  return Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
}

export const ACTIVATION_POLICIES = [
  /** Clock starts when payment is verified / voucher is issued. Must be disclosed before checkout. */
  'ON_PURCHASE',
  /** Clock starts when the voucher is first redeemed in the portal. */
  'ON_FIRST_REDEMPTION',
  /** Clock starts when the gateway confirms the first successful network authorization. (Recommended default.) */
  'ON_FIRST_AUTHORIZATION',
] as const;
export type ActivationPolicy = (typeof ACTIVATION_POLICIES)[number];

export const RENEWAL_RULES = ['STACK_AFTER_CURRENT_EXPIRY', 'EXTEND_FROM_NOW', 'REPLACE'] as const;
export type RenewalRule = (typeof RENEWAL_RULES)[number];

export interface RenewalWindow {
  startsAt: Date;
  expiresAt: Date;
  /** True when applying this renewal ends the current entitlement earlier than its paid expiry. */
  shortensCurrent: boolean;
}

/**
 * Compute when a renewal's validity runs. Default rule stacks after the current
 * expiry so paid time is never lost. Other rules report `shortensCurrent` so the
 * UI must disclose it before payment.
 */
export function computeRenewalWindow(args: {
  now: Date;
  currentExpiresAt: Date | null;
  duration: PlanDuration;
  timeZone: string;
  rule: RenewalRule;
}): RenewalWindow {
  const { now, currentExpiresAt, duration, timeZone, rule } = args;
  const currentActive = currentExpiresAt !== null && !hasExpired(now, currentExpiresAt);
  if (rule === 'STACK_AFTER_CURRENT_EXPIRY' && currentActive) {
    return {
      startsAt: currentExpiresAt,
      expiresAt: addDuration(currentExpiresAt, duration, timeZone),
      shortensCurrent: false,
    };
  }
  const expiresAt = addDuration(now, duration, timeZone);
  const shortensCurrent =
    currentActive &&
    (rule === 'REPLACE' || expiresAt.getTime() < (currentExpiresAt as Date).getTime());
  return { startsAt: now, expiresAt, shortensCurrent };
}
