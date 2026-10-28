import { describe, expect, it } from 'vitest';
import { DomainError } from './errors.js';
import {
  addCalendarMonths,
  addDuration,
  computeRenewalWindow,
  fromZonedParts,
  hasExpired,
  isWithinValidity,
  remainingSeconds,
  toZonedParts,
} from './time.js';

const LAGOS = 'Africa/Lagos';
const iso = (s: string) => new Date(s);

describe('addDuration', () => {
  it('adds fixed units in UTC', () => {
    const start = iso('2026-01-01T10:00:00Z');
    expect(addDuration(start, { value: 30, unit: 'MINUTE' }, LAGOS).toISOString()).toBe(
      '2026-01-01T10:30:00.000Z',
    );
    expect(addDuration(start, { value: 3, unit: 'HOUR' }, LAGOS).toISOString()).toBe(
      '2026-01-01T13:00:00.000Z',
    );
    expect(addDuration(start, { value: 7, unit: 'DAY' }, LAGOS).toISOString()).toBe(
      '2026-01-08T10:00:00.000Z',
    );
    expect(addDuration(start, { value: 2, unit: 'WEEK' }, LAGOS).toISOString()).toBe(
      '2026-01-15T10:00:00.000Z',
    );
  });

  it.each([0, -1, 1.5, 10_000])('rejects invalid value %s', (value) => {
    expect(() => addDuration(new Date(), { value, unit: 'DAY' }, LAGOS)).toThrow(DomainError);
  });

  it('rejects unknown time zones', () => {
    expect(() =>
      addDuration(new Date(), { value: 1, unit: 'CALENDAR_MONTH' }, 'Mars/Base'),
    ).toThrow(DomainError);
  });
});

describe('calendar months (Africa/Lagos, UTC+1)', () => {
  it('keeps local wall-clock time', () => {
    // 2026-03-15 09:00 Lagos = 08:00Z
    const r = addCalendarMonths(iso('2026-03-15T08:00:00Z'), 1, LAGOS);
    expect(r.toISOString()).toBe('2026-04-15T08:00:00.000Z');
  });

  it('clamps Jan 31 → Feb 28 in a non-leap year and Feb 29 in a leap year', () => {
    expect(addCalendarMonths(iso('2026-01-31T12:00:00Z'), 1, LAGOS).toISOString()).toBe(
      '2026-02-28T12:00:00.000Z',
    );
    expect(addCalendarMonths(iso('2028-01-31T12:00:00Z'), 1, LAGOS).toISOString()).toBe(
      '2028-02-29T12:00:00.000Z',
    );
  });

  it('uses the LOCAL date, not the UTC date, near midnight', () => {
    // 2026-01-31 23:30Z is already 2026-02-01 00:30 in Lagos → +1 month = 2026-03-01 00:30 local
    const r = addCalendarMonths(iso('2026-01-31T23:30:00Z'), 1, LAGOS);
    expect(r.toISOString()).toBe('2026-02-28T23:30:00.000Z');
  });

  it('crosses year boundary', () => {
    expect(addCalendarMonths(iso('2026-11-30T10:00:00Z'), 3, LAGOS).toISOString()).toBe(
      '2027-02-28T10:00:00.000Z',
    );
  });

  it('handles DST zones (documented rule for future properties)', () => {
    // London: 2026-03-29 01:00 → clocks jump to 02:00 (BST). Feb 29 01:30 doesn't exist in 2026; use Feb 28.
    const london = 'Europe/London';
    const start = fromZonedParts(
      { year: 2026, month: 2, day: 28, hour: 9, minute: 0, second: 0, millisecond: 0 },
      london,
    );
    const r = addCalendarMonths(start, 1, london);
    expect(toZonedParts(r, london)).toMatchObject({ month: 3, day: 28, hour: 9 });
    expect(r.toISOString()).toBe('2026-03-28T09:00:00.000Z'); // still GMT on Mar 28
    const r2 = addCalendarMonths(start, 2, london);
    expect(r2.toISOString()).toBe('2026-04-28T08:00:00.000Z'); // BST = UTC+1
  });

  it('resolves a non-existent local time (spring-forward gap) to a valid later instant', () => {
    const london = 'Europe/London';
    const r = fromZonedParts(
      { year: 2026, month: 3, day: 29, hour: 1, minute: 30, second: 0, millisecond: 0 },
      london,
    );
    const p = toZonedParts(r, london);
    expect(p.hour).toBe(2);
    expect(p.minute).toBe(30);
  });
});

describe('validity boundaries (half-open)', () => {
  const start = iso('2026-05-01T00:00:00Z');
  const end = iso('2026-05-02T00:00:00Z');

  it('is valid at the start instant', () => expect(isWithinValidity(start, start, end)).toBe(true));
  it('is valid 1ms before expiry', () =>
    expect(isWithinValidity(new Date(end.getTime() - 1), start, end)).toBe(true));
  it('is NOT valid at the exact expiry instant', () => {
    expect(isWithinValidity(end, start, end)).toBe(false);
    expect(hasExpired(end, end)).toBe(true);
  });
  it('is not valid before start', () =>
    expect(isWithinValidity(new Date(start.getTime() - 1), start, end)).toBe(false));

  it('remainingSeconds floors and never goes negative', () => {
    expect(remainingSeconds(new Date(end.getTime() - 1500), end)).toBe(1);
    expect(remainingSeconds(new Date(end.getTime() + 5000), end)).toBe(0);
  });
});

describe('computeRenewalWindow', () => {
  const now = iso('2026-06-10T12:00:00Z');
  const day = { value: 1, unit: 'DAY' } as const;

  it('stacks after current expiry when current is active', () => {
    const w = computeRenewalWindow({
      now,
      currentExpiresAt: iso('2026-06-11T00:00:00Z'),
      duration: day,
      timeZone: LAGOS,
      rule: 'STACK_AFTER_CURRENT_EXPIRY',
    });
    expect(w.startsAt.toISOString()).toBe('2026-06-11T00:00:00.000Z');
    expect(w.expiresAt.toISOString()).toBe('2026-06-12T00:00:00.000Z');
    expect(w.shortensCurrent).toBe(false);
  });

  it('starts now when the current entitlement has already expired', () => {
    const w = computeRenewalWindow({
      now,
      currentExpiresAt: iso('2026-06-01T00:00:00Z'),
      duration: day,
      timeZone: LAGOS,
      rule: 'STACK_AFTER_CURRENT_EXPIRY',
    });
    expect(w.startsAt).toEqual(now);
  });

  it('flags REPLACE as shortening an active entitlement', () => {
    const w = computeRenewalWindow({
      now,
      currentExpiresAt: iso('2026-06-30T00:00:00Z'),
      duration: day,
      timeZone: LAGOS,
      rule: 'REPLACE',
    });
    expect(w.shortensCurrent).toBe(true);
  });

  it('flags EXTEND_FROM_NOW only when it would end earlier than current', () => {
    const base = {
      now,
      duration: { value: 7, unit: 'DAY' } as const,
      timeZone: LAGOS,
      rule: 'EXTEND_FROM_NOW' as const,
    };
    expect(
      computeRenewalWindow({ ...base, currentExpiresAt: iso('2026-06-11T00:00:00Z') })
        .shortensCurrent,
    ).toBe(false);
    expect(
      computeRenewalWindow({ ...base, currentExpiresAt: iso('2026-07-30T00:00:00Z') })
        .shortensCurrent,
    ).toBe(true);
  });
});
