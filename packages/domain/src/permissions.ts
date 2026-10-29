/**
 * Role-based permissions (spec §15). The code is the source of truth; the
 * roles/permissions tables mirror it (synced by `npm run db:sync-rbac`) so grants
 * are visible and auditable in the database.
 *
 * Rules:
 * - Deny by default: anything not listed is refused.
 * - Staff permissions apply only to the property a role was granted on.
 *   OWNER granted platform-wide (propertyId = null) applies everywhere.
 * - Tenant self-service is authorized by ownership checks in services, not by
 *   these staff permissions.
 */

export const PERMISSIONS = {
  'property.create': 'Create properties',
  'property.read': 'View property structure (buildings, floors, rooms)',
  'property.manage': 'Create and edit buildings, floors, rooms and zones',
  'tenant.read': 'View tenants and their room assignments',
  'tenant.manage': 'Create tenants, assign/move rooms, record departures',
  'group.manage': 'Grant and revoke room/floor purchase authority',
  'staff.read': 'View staff accounts and their roles',
  'staff.manage': 'Create staff accounts and grant or revoke roles',
  'audit.read': 'View audit logs',
  'plan.read': 'View plans and plan versions',
  'plan.manage': 'Create, version, publish, pause and archive plans',
  'voucher.read': 'View voucher status (never codes)',
  'voucher.issue': 'Issue complimentary/manual/promotional vouchers',
  'voucher.manage': 'Suspend, revoke and reissue vouchers',
  'subscription.read': 'View subscriptions and entitlements',
  'subscription.manage': 'Suspend, revoke or extend entitlements',
  'payment.read': 'View payments and provider references',
  'payment.refund.request': 'Request a refund',
  'payment.refund.approve': 'Approve a refund requested by someone else',
  'payment.reconcile': 'Run and resolve payment reconciliation',
  'report.export': 'Download reports',
  'network.read': 'View gateways, sessions and provisioning jobs',
  'network.operate': 'Retry jobs, disconnect, suspend or revoke network access',
  'support.manage': 'Handle support tickets',
  'settings.manage': 'Change property settings',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const STAFF_ROLES = [
  'OWNER',
  'PROPERTY_ADMIN',
  'NETWORK_ADMIN',
  'FINANCE',
  'SUPPORT',
] as const;
export const TENANT_ROLES = ['TENANT', 'GROUP_MANAGER'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export type RoleKey = StaffRole | (typeof TENANT_ROLES)[number];

export const ROLE_NAMES: Record<RoleKey, string> = {
  OWNER: 'Platform owner',
  PROPERTY_ADMIN: 'Property administrator',
  NETWORK_ADMIN: 'Network administrator',
  FINANCE: 'Finance staff',
  SUPPORT: 'Support staff',
  TENANT: 'Tenant',
  GROUP_MANAGER: 'Room/floor group manager',
};

export const ROLE_PERMISSIONS: Record<RoleKey, readonly Permission[]> = {
  OWNER: ALL_PERMISSIONS,
  PROPERTY_ADMIN: [
    'property.read',
    'property.manage',
    'tenant.read',
    'tenant.manage',
    'group.manage',
    'staff.read',
    'audit.read',
    'plan.read',
    'plan.manage',
    'voucher.read',
    'voucher.issue',
    'voucher.manage',
    'subscription.read',
    'subscription.manage',
    'support.manage',
    'settings.manage',
  ],
  // No financial data, no tenant management.
  NETWORK_ADMIN: ['property.read', 'network.read', 'network.operate', 'subscription.read'],
  // No router access, no network controls, no tenant management.
  FINANCE: [
    'property.read',
    'payment.read',
    'payment.refund.request',
    'payment.refund.approve',
    'payment.reconcile',
    'report.export',
    'subscription.read',
  ],
  // Status lookups and tickets; no refunds, no network controls.
  SUPPORT: [
    'property.read',
    'tenant.read',
    'subscription.read',
    'voucher.read',
    'payment.read',
    'support.manage',
  ],
  TENANT: [],
  GROUP_MANAGER: [],
};

export interface RoleGrant {
  readonly role: RoleKey;
  /** null = platform-wide (OWNER only). */
  readonly propertyId: string | null;
}

export interface Actor {
  readonly userId: string;
  readonly kind: 'STAFF' | 'TENANT';
  readonly grants: readonly RoleGrant[];
}

/** Deny-by-default permission check scoped to a property. */
export function can(actor: Actor, permission: Permission, propertyId: string | null): boolean {
  if (actor.kind !== 'STAFF') return false;
  return actor.grants.some(
    (g) =>
      ROLE_PERMISSIONS[g.role].includes(permission) &&
      ((g.role === 'OWNER' && g.propertyId === null) ||
        (propertyId !== null && g.propertyId === propertyId)),
  );
}

/** Properties where the actor holds `permission`; 'ALL' for platform owners. */
export function propertiesWith(actor: Actor, permission: Permission): 'ALL' | string[] {
  if (actor.kind !== 'STAFF') return [];
  if (actor.grants.some((g) => g.role === 'OWNER' && g.propertyId === null)) return 'ALL';
  return [
    ...new Set(
      actor.grants
        .filter((g) => g.propertyId !== null && ROLE_PERMISSIONS[g.role].includes(permission))
        .map((g) => g.propertyId as string),
    ),
  ];
}

/**
 * Only a platform owner may grant or revoke staff roles, and OWNER itself is only
 * ever granted platform-wide. Prevents property admins escalating themselves.
 */
export function canGrantRole(actor: Actor, role: RoleKey, propertyId: string | null): boolean {
  if (!can(actor, 'staff.manage', propertyId)) return false;
  if (!actor.grants.some((g) => g.role === 'OWNER' && g.propertyId === null)) return false;
  if (role === 'OWNER') return propertyId === null;
  if ((TENANT_ROLES as readonly string[]).includes(role)) return false;
  return propertyId !== null;
}
