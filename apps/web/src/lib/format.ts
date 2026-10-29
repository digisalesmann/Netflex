import type { PublicPlan } from './types';

const UNIT: Record<string, [string, string]> = {
  MINUTE: ['minute', 'minutes'],
  HOUR: ['hour', 'hours'],
  DAY: ['day', 'days'],
  WEEK: ['week', 'weeks'],
  CALENDAR_MONTH: ['month', 'months'],
};

export function duration(d: { value: number; unit: string }): string {
  const [one, many] = UNIT[d.unit] ?? [d.unit.toLowerCase(), d.unit.toLowerCase()];
  return `${d.value} ${d.value === 1 ? one : many}`;
}

export function activation(p: Pick<PublicPlan, 'activationPolicy' | 'redemptionWindow'>): string {
  const window = p.redemptionWindow
    ? ` Use it within ${duration(p.redemptionWindow)} of purchase.`
    : '';
  switch (p.activationPolicy) {
    case 'ON_PURCHASE':
      return 'Time starts as soon as payment is confirmed.';
    case 'ON_FIRST_REDEMPTION':
      return `Time starts when you first enter your code.${window}`;
    default:
      return `Time starts when you first connect to the Wi-Fi.${window}`;
  }
}

export function speed(p: PublicPlan['speed']): string {
  const mbps = (k: number) => (k >= 1000 ? `${Math.round(k / 100) / 10} Mbps` : `${k} kbps`);
  if (p.downloadKbps === null && p.uploadKbps === null)
    return 'No plan speed cap. Speeds vary with demand and conditions; not guaranteed.';
  return `Up to ${p.downloadKbps !== null ? mbps(p.downloadKbps) : 'uncapped'} down / ${p.uploadKbps !== null ? mbps(p.uploadKbps) : 'uncapped'} up. Not guaranteed.`;
}

export const scopeLabel = {
  INDIVIDUAL: 'Just you',
  ROOM: 'Whole room',
  FLOOR: 'Whole floor',
} as const;

export function remaining(seconds: number | null): string {
  if (seconds === null) return 'Starts when you first connect';
  if (seconds <= 0) return 'Ended';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d} day${d === 1 ? '' : 's'} ${h} h left`;
  if (h) return `${h} h ${m} min left`;
  return `${m} min left`;
}
