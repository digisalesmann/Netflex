import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
  can,
  canGrantRole,
  propertiesWith,
  type Actor,
  type Permission,
  type RoleKey,
} from './permissions.js';

const A = 'prop-A';
const B = 'prop-B';
const staff = (role: RoleKey, propertyId: string | null = A): Actor => ({
  userId: `u-${role}`,
  kind: 'STAFF',
  grants: [{ role, propertyId }],
});
const owner = staff('OWNER', null);

describe('can()', () => {
  it('platform owner can do everything everywhere', () => {
    for (const p of ALL_PERMISSIONS) {
      expect(can(owner, p, A)).toBe(true);
      expect(can(owner, p, B)).toBe(true);
    }
  });

  it('an OWNER role scoped to a property is not platform-wide', () => {
    expect(can(staff('OWNER', A), 'property.read', B)).toBe(false);
  });

  it('property-scoped roles never cross properties', () => {
    for (const role of ['PROPERTY_ADMIN', 'NETWORK_ADMIN', 'FINANCE', 'SUPPORT'] as const) {
      for (const p of ROLE_PERMISSIONS[role]) {
        expect(can(staff(role), p, A)).toBe(true);
        expect(can(staff(role), p, B)).toBe(false);
        expect(can(staff(role), p, null)).toBe(false);
      }
    }
  });

  it.each<[RoleKey, Permission]>([
    ['FINANCE', 'network.operate'],
    ['FINANCE', 'tenant.manage'],
    ['SUPPORT', 'payment.refund.approve'],
    ['SUPPORT', 'network.operate'],
    ['NETWORK_ADMIN', 'payment.read'],
    ['NETWORK_ADMIN', 'tenant.manage'],
    ['PROPERTY_ADMIN', 'staff.manage'],
    ['PROPERTY_ADMIN', 'payment.refund.approve'],
    ['PROPERTY_ADMIN', 'property.create'],
  ])('%s cannot %s (least privilege)', (role, perm) => {
    expect(can(staff(role), perm, A)).toBe(false);
  });

  it('tenants have no staff permissions even with a grant row', () => {
    const t: Actor = { userId: 't', kind: 'TENANT', grants: [{ role: 'OWNER', propertyId: null }] };
    expect(can(t, 'property.read', A)).toBe(false);
    expect(propertiesWith(t, 'property.read')).toEqual([]);
  });

  it('no grants → no access', () => {
    expect(can({ userId: 'x', kind: 'STAFF', grants: [] }, 'property.read', A)).toBe(false);
  });
});

describe('propertiesWith()', () => {
  it('lists only granted properties', () => {
    const multi: Actor = {
      userId: 'm',
      kind: 'STAFF',
      grants: [
        { role: 'SUPPORT', propertyId: A },
        { role: 'FINANCE', propertyId: B },
      ],
    };
    expect(propertiesWith(multi, 'tenant.read')).toEqual([A]);
    expect(propertiesWith(multi, 'payment.reconcile')).toEqual([B]);
    expect(propertiesWith(owner, 'tenant.read')).toBe('ALL');
  });
});

describe('canGrantRole()', () => {
  it('only a platform owner can grant roles', () => {
    expect(canGrantRole(owner, 'PROPERTY_ADMIN', A)).toBe(true);
    expect(canGrantRole(staff('PROPERTY_ADMIN'), 'SUPPORT', A)).toBe(false);
    expect(canGrantRole(staff('PROPERTY_ADMIN'), 'PROPERTY_ADMIN', A)).toBe(false);
  });
  it('OWNER is only granted platform-wide; staff roles only per property', () => {
    expect(canGrantRole(owner, 'OWNER', null)).toBe(true);
    expect(canGrantRole(owner, 'OWNER', A)).toBe(false);
    expect(canGrantRole(owner, 'FINANCE', null)).toBe(false);
    expect(canGrantRole(owner, 'TENANT', A)).toBe(false);
  });
});
