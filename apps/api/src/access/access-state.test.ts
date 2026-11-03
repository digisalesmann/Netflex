import { describe, expect, it } from 'vitest';
import { accessState, expiringSoonWindow, termSeconds } from './lifecycle.service.js';

const H = 3600;

describe('expiring-soon window', () => {
  it('is the last fifth of a short term, capped at 24 hours', () => {
    expect(expiringSoonWindow(24 * H)).toBe(Math.floor((24 * H) / 5));
    expect(expiringSoonWindow(7 * 24 * H)).toBe(24 * H);
    expect(expiringSoonWindow(null)).toBe(24 * H);
  });

  it('a fresh 1-day pass is ACTIVE; it reads EXPIRING_SOON in its last fifth', () => {
    const day = 24 * H;
    expect(accessState('ACTIVE', 'ACTIVE', day - 60, day)).toBe('ACTIVE');
    expect(accessState('ACTIVE', 'ACTIVE', Math.floor(day / 5) + 1, day)).toBe('ACTIVE');
    expect(accessState('ACTIVE', 'ACTIVE', Math.floor(day / 5) - 1, day)).toBe('EXPIRING_SOON');
  });

  it('a week pass warns in its final 24 hours', () => {
    const week = 7 * 24 * H;
    expect(accessState('ACTIVE', 'ACTIVE', 25 * H, week)).toBe('ACTIVE');
    expect(accessState('ACTIVE', 'ACTIVE', 23 * H, week)).toBe('EXPIRING_SOON');
  });

  it('never claims a connection the gateway has not confirmed', () => {
    expect(accessState('ACTIVE', 'PENDING', 10, 24 * H)).toBe('ACCESS_BEING_CONFIGURED');
  });

  it('measures the term from start to (renewed) expiry', () => {
    const startsAt = new Date('2026-10-01T00:00:00Z');
    expect(termSeconds({ startsAt, expiresAt: new Date('2026-10-02T00:00:00Z') })).toBe(24 * H);
    expect(termSeconds({ startsAt: null, expiresAt: startsAt })).toBeNull();
  });
});
