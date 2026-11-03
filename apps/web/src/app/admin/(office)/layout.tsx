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
  {
    href: '/admin/plans',
    label: 'Plans',
    need: 'plan.read',
    icon: 'M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4zM9 8.5h6M9 12h6M9 15.5h3.5',
  },
  {
    href: '/admin/vouchers',
    label: 'Vouchers',
    need: 'voucher.read',
    icon: 'M5.5 6h13A1.5 1.5 0 0 1 20 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5V14a2 2 0 0 0 0-4V7.5A1.5 1.5 0 0 1 5.5 6zM14.5 6.5v1.5M14.5 11.25v1.5M14.5 16v1.5',
  },
  {
    href: '/admin/payments',
    label: 'Payments',
    need: 'payment.read',
    icon: 'M3.5 6.5h17v11h-17zM3.5 10h17M7 14.5h3',
  },
  {
    href: '/admin/support',
    label: 'Support',
    need: 'support.manage',
    icon: 'M4 5.5h16v10H9l-5 4zM8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01',
  },
  {
    href: '/admin/staff',
    label: 'Staff',
    need: 'staff.read',
    icon: 'M12 3.5 5 6.5v5c0 4.3 3 7.6 7 8.9 4-1.3 7-4.6 7-8.9v-5zM12 11a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5zM8.5 15.5c.6-1.7 1.9-2.6 3.5-2.6s2.9.9 3.5 2.6',
  },
  {
    href: '/admin/activity',
    label: 'Activity',
    need: 'audit.read',
    icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2',
  },
  {
    href: '/admin/settings',
    label: 'Settings',
    icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
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
