import type { PublicPlan } from './types';

/** Shared plan maths for the home page and the Plans page. */

const DAYS: Record<string, number> = {
  MINUTE: 1 / 1440,
  HOUR: 1 / 24,
  DAY: 1,
  WEEK: 7,
  CALENDAR_MONTH: 30,
};

export function days(p: PublicPlan): number | null {
  const f = DAYS[p.duration.unit];
  return f ? p.duration.value * f : null;
}

/** Whole naira without kobo when there are none, e.g. "₦2,500". */
export function money(amountMinor: bigint | number, currency: string): string {
  const major = Number(amountMinor) / 100;
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
    maximumFractionDigits: Number.isInteger(major) ? 0 : 2,
    minimumFractionDigits: Number.isInteger(major) ? 0 : 2,
  }).format(major);
}

/** Approximate price per day for plans of 2+ days, in whole naira. */
export function perDay(p: PublicPlan): bigint | null {
  const d = days(p);
  return d && d >= 2 ? BigInt(Math.round(Number(p.price.amountMinor) / d / 100) * 100) : null;
}

/**
 * The plan with the lowest price per day among those shown, if it beats the
 * shortest one. Only compares plans of the same audience.
 */
export function lowestDaily(plans: PublicPlan[]): string | null {
  const timed = plans.filter((p) => days(p) !== null);
  if (timed.length < 2 || new Set(timed.map((p) => p.scope)).size > 1) return null;
  const rate = (p: PublicPlan) => Number(p.price.amountMinor) / (days(p) as number);
  const best = [...timed].sort((a, b) => rate(a) - rate(b))[0];
  const shortest = [...timed].sort((a, b) => (days(a) as number) - (days(b) as number))[0];
  return best && shortest && best !== shortest && rate(best) < rate(shortest)
    ? best.planVersionId
    : null;
}

export const AUDIENCES = [
  {
    id: 'you',
    scope: 'INDIVIDUAL',
    label: 'For you',
    short: 'For you',
    blurb: 'Your own devices. Buy on the Wi-Fi sign-in page or from your account.',
  },
  {
    id: 'room',
    scope: 'ROOM',
    label: 'Whole room',
    short: 'Room',
    blurb: 'One plan shared with the residents of your room, each on their own devices.',
  },
  {
    id: 'floor',
    scope: 'FLOOR',
    label: 'Whole floor',
    short: 'Floor',
    blurb: 'One plan for every resident on your floor who is added to it.',
  },
] as const;
export type AudienceId = (typeof AUDIENCES)[number]['id'];

export const LENGTHS = [
  { id: 'hourly', label: 'Hourly' },
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
] as const;
export type LengthId = (typeof LENGTHS)[number]['id'];

/** Hourly (< 1 day), daily (1–6 days), weekly (7–27 days), monthly (28+ days). */
export function lengthOf(p: PublicPlan): LengthId {
  const d = days(p) ?? 0;
  if (d < 1) return 'hourly';
  if (d < 7) return 'daily';
  if (d < 28) return 'weekly';
  return 'monthly';
}

/** Shortest first; same length, cheapest first. */
export function sortPlans(plans: PublicPlan[]): PublicPlan[] {
  return [...plans].sort(
    (a, b) =>
      (days(a) ?? 0) - (days(b) ?? 0) || Number(a.price.amountMinor) - Number(b.price.amountMinor),
  );
}

/** Up to three personal plans for the home page: a short, a weekly-ish and a long one. */
export function featured(plans: PublicPlan[]): PublicPlan[] {
  const personal = sortPlans(plans.filter((p) => p.scope === 'INDIVIDUAL' && (days(p) ?? 0) >= 1));
  if (personal.length <= 3) return personal.length ? personal : sortPlans(plans).slice(0, 3);
  const first = personal[0] as PublicPlan;
  const last = personal[personal.length - 1] as PublicPlan;
  const middle = personal
    .slice(1, -1)
    .sort((a, b) => Math.abs((days(a) ?? 0) - 7) - Math.abs((days(b) ?? 0) - 7))[0] as PublicPlan;
  return [first, middle, last];
}
