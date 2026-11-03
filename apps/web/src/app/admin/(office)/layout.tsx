import { ROLE_NAMES, type Permission } from '@netflex/domain/dist/permissions.js';
import type { ReactNode } from 'react';
import { AdminShell, type NavItem } from '@/components/admin/AdminShell';
import { allowed, currentProperty, requireStaff } from '@/lib/admin';

export const metadata = {
  title: { default: 'Office', template: '%s · Office' },
  robots: { index: false, follow: false },
};

/** Office sections, each shown only to roles that can use it. Grows as screens are built. */
const NAV: (NavItem & { need?: Permission })[] = [
  { href: '/admin', label: 'Overview', icon: 'M4 11.5 12 4l8 7.5V20h-5v-5h-6v5H4z' },
];

export default async function OfficeLayout({ children }: { children: ReactNode }) {
  const me = await requireStaff('/admin');
  const { property, all } = await currentProperty();
  const nav = NAV.filter((n) => !n.need || allowed(me, n.need, property?.id ?? null));
  const top = me.grants.find((g) => g.role === 'OWNER') ?? me.grants[0];
  return (
    <AdminShell
      nav={nav}
      user={{ name: me.user.displayName, role: top ? ROLE_NAMES[top.role] : 'Staff' }}
      property={property ? { id: property.id, name: property.name } : null}
      properties={all.map((p) => ({ id: p.id, name: p.name }))}
    >
      {children}
    </AdminShell>
  );
}
