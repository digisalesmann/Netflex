import { serverApi } from './server-api';

export interface Room {
  id: string;
  label: string;
}
export interface Floor {
  id: string;
  label: string;
  level: number;
  rooms: Room[];
}
export interface Building {
  id: string;
  name: string;
  floors: Floor[];
}
export interface PropertyDetail {
  id: string;
  name: string;
  buildings: Building[];
}
export interface TenantRow {
  id: string;
  displayName: string;
  email: string | null;
  phoneE164: string | null;
  status: string;
  currentAssignment: {
    id: string;
    startsAt: string;
    room: { id: string; label: string; floorId: string };
  } | null;
}

/** "2" before "10". */
export const byLabel = (a: { label: string }, b: { label: string }) =>
  a.label.localeCompare(b.label, 'en', { numeric: true, sensitivity: 'base' });

/** Buildings → floors (by level) → rooms (natural order). */
export async function propertyStructure(propertyId: string): Promise<PropertyDetail | null> {
  const r = await serverApi<PropertyDetail>(`/admin/properties/${propertyId}`, { auth: true });
  if (!r.data) return null;
  for (const b of r.data.buildings) {
    b.floors.sort((x, y) => x.level - y.level);
    for (const f of b.floors) f.rooms.sort(byLabel);
  }
  return r.data;
}

/** Every resident on record at the property (follows pages; a lodge has at most a few hundred). */
export async function allTenants(propertyId: string, search?: string): Promise<TenantRow[]> {
  const out: TenantRow[] = [];
  let cursor: string | null | undefined;
  for (let page = 0; page < 20; page++) {
    const qs = new URLSearchParams({ limit: '100' });
    if (cursor) qs.set('cursor', cursor);
    if (search) qs.set('search', search);
    const r = await serverApi<TenantRow[]>(`/admin/properties/${propertyId}/tenants?${qs}`, {
      auth: true,
    });
    out.push(...(r.data ?? []));
    cursor = r.meta?.nextCursor;
    if (!cursor) break;
  }
  return out;
}

export const shortDate = (iso: string) =>
  new Intl.DateTimeFormat('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Africa/Lagos',
  }).format(new Date(iso));

/** Room options grouped by floor, for selects. */
export function roomOptions(p: PropertyDetail) {
  return p.buildings.flatMap((b) =>
    b.floors.map((f) => ({
      group: p.buildings.length > 1 ? `${b.name} · ${f.label}` : f.label,
      floorId: f.id,
      rooms: f.rooms,
    })),
  );
}
