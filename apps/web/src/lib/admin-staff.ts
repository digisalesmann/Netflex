import { serverApi } from './server-api';

export interface StaffRow {
  id: string;
  displayName: string;
  email: string | null;
  status: 'ACTIVE' | 'DISABLED';
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  grants: { id: string; role: string; propertyId: string | null }[];
}

export async function staffList(): Promise<StaffRow[]> {
  return (await serverApi<StaffRow[]>('/admin/staff', { auth: true })).data ?? [];
}

/** Highest role first, for the one badge shown in lists. */
const ORDER = ['OWNER', 'PROPERTY_ADMIN', 'FINANCE', 'NETWORK_ADMIN', 'SUPPORT'];
export const mainRole = (s: StaffRow) =>
  [...s.grants].sort((a, b) => ORDER.indexOf(a.role) - ORDER.indexOf(b.role))[0]?.role ?? null;

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

/** "Today", "Yesterday", "4 days ago", or a date. */
export function lastSeen(iso: string | null): string {
  if (!iso) return 'Never';
  const lagos = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(d);
  const days = Math.round(
    (Date.parse(lagos(new Date())) - Date.parse(lagos(new Date(iso)))) / 86_400_000,
  );
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Intl.DateTimeFormat('en-NG', {
    day: 'numeric',
    month: 'short',
    ...(days > 300 ? { year: 'numeric' } : {}),
    timeZone: 'Africa/Lagos',
  }).format(new Date(iso));
}
