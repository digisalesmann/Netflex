import { can, type Permission, type RoleGrant } from '@netflex/domain/dist/permissions.js';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { serverApi } from './server-api';

export interface StaffMe {
  user: {
    id: string;
    kind: 'STAFF' | 'TENANT';
    displayName: string;
    email: string | null;
    mfaEnabled: boolean;
    mustChangePassword: boolean;
  };
  grants: RoleGrant[];
  session: { id: string; mfaSatisfied: boolean };
}

export interface AdminProperty {
  id: string;
  slug: string;
  name: string;
  timeZone: string;
  currency: string;
  supportPhone: string | null;
  supportEmail: string | null;
}

export const PROPERTY_COOKIE = 'nf_admin_property';

/** Fully signed-in staff (password + two-step, password up to date) or redirect to sign-in. */
export async function requireStaff(next: string): Promise<StaffMe> {
  const r = await serverApi<StaffMe>('/me', { auth: true });
  const back = `/admin/sign-in?next=${encodeURIComponent(next)}`;
  if (r.status === 401 || !r.data) redirect(back);
  if (r.data.user.kind !== 'STAFF') redirect('/account');
  if (!r.data.session.mfaSatisfied || r.data.user.mustChangePassword) redirect(back);
  return r.data;
}

/** The property being managed: the one picked in the switcher, else the first. */
export async function currentProperty(): Promise<{
  property: AdminProperty | null;
  all: AdminProperty[];
}> {
  const r = await serverApi<AdminProperty[]>('/admin/properties', { auth: true });
  const all = r.data ?? [];
  const picked = (await cookies()).get(PROPERTY_COOKIE)?.value;
  return { property: all.find((p) => p.id === picked) ?? all[0] ?? null, all };
}

export function allowed(me: StaffMe, permission: Permission, propertyId: string | null): boolean {
  return can({ userId: me.user.id, kind: 'STAFF', grants: me.grants }, permission, propertyId);
}

/** Server-side admin read scoped to a property: `/admin/properties/:id${path}`. */
export function adminApi<T>(propertyId: string, path: string) {
  return serverApi<T>(`/admin/properties/${propertyId}${path}`, { auth: true });
}
