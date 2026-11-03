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
  {
    href: '/admin/residents',
    label: 'Residents',
    need: 'tenant.read',
    icon: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.9-3.2 3.4-5 6.5-5s5.6 1.8 6.5 5M16 4.5a3.5 3.5 0 0 1 0 6.5M18.5 15c1.6.8 2.6 2.4 3 5',
  },
  {
    href: '/admin/rooms',
    label: 'Rooms',
    need: 'property.read',
    icon: 'M4 20V5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5V20M16 9h2.5A1.5 1.5 0 0 1 20 10.5V20M2.5 20h19M12.5 12.5h.01',
  },
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
