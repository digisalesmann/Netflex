import { redirect } from 'next/navigation';
import { serverApi } from './server-api';
import type { PublicPlan } from './types';

export interface Me {
  user: {
    id: string;
    kind: 'STAFF' | 'TENANT';
    displayName: string;
    email: string | null;
    phoneE164: string | null;
  };
  residence: {
    startsAt: string;
    property: { id: string; name: string; slug: string };
    room: { id: string; label: string; floor: { id: string; label: string } };
  }[];
  purchaseAuthority: {
    scope: 'ROOM' | 'FLOOR';
    roomId: string | null;
    floorId: string | null;
    propertyId: string;
  }[];
}

export interface Access {
  entitlementId: string;
  planId: string;
  property: string;
  planName: string;
  scope: 'INDIVIDUAL' | 'ROOM' | 'FLOOR';
  role: 'OWNER' | 'MANAGER' | 'MEMBER';
  myMembershipId: string | null;
  state: string;
  startsAt: string | null;
  expiresAt: string | null;
  expiresAtLocal: string | null;
  activateBy: string | null;
  remainingSeconds: number | null;
  voucherHint: string | null;
  devices: {
    limit: number;
    inUse: number;
    list: {
      redemptionId: string;
      mine: boolean;
      since: string;
      label: string | null;
      macSuffix: string;
    }[];
  };
  members?: {
    membershipId: string;
    userId: string;
    name: string;
    contactHint: string;
    role: string;
  }[];
  usage: { available: boolean; note: string };
}

/** Signed-in tenant or redirect to sign-in. Staff are sent to their own portal. */
export async function requireTenant(next: string): Promise<Me> {
  const r = await serverApi<Me>('/me', { auth: true });
  if (r.status === 401 || !r.data) redirect(`/account/sign-in?next=${encodeURIComponent(next)}`);
  if (r.data.user.kind !== 'TENANT') redirect('/account/sign-in?staff=1');
  return r.data;
}

export const STATE_LABEL: Record<string, { tone: 'ok' | 'warn' | 'bad' | 'info'; label: string }> =
  {
    VOUCHER_AVAILABLE: { tone: 'info', label: 'Voucher available — not started' },
    ACCESS_BEING_CONFIGURED: { tone: 'info', label: 'Access being configured' },
    ACTIVE: { tone: 'ok', label: 'Connected' },
    EXPIRING_SOON: { tone: 'warn', label: 'Expiring soon' },
    ACCESS_SUSPENDED: { tone: 'warn', label: 'Access suspended' },
    SUBSCRIPTION_EXPIRED: { tone: 'bad', label: 'Expired' },
    ACCESS_REVOKED: { tone: 'bad', label: 'Cancelled' },
    PROVISIONING_NEEDS_ATTENTION: { tone: 'warn', label: 'Provisioning needs attention' },
  };

export type PurchaseTarget =
  { scope: 'INDIVIDUAL' } | { scope: 'ROOM'; roomId: string } | { scope: 'FLOOR'; floorId: string };
export type Eligible = { target: PurchaseTarget | null; label: string };

/** Who this resident may buy a plan for, or why they can't. */
export function eligibilityFor(me: Me, slug: string, p: PublicPlan): Eligible {
  const home = me.residence.find((r) => r.property.slug === slug);
  if (p.scope === 'INDIVIDUAL') return { target: { scope: 'INDIVIDUAL' }, label: 'Just for you' };
  if (!home)
    return {
      target: null,
      label: 'Register with the property office to buy room or floor plans.',
    };
  if (p.scope === 'ROOM') {
    const ok = me.purchaseAuthority.some((a) => a.scope === 'ROOM' && a.roomId === home.room.id);
    return ok
      ? {
          target: { scope: 'ROOM', roomId: home.room.id },
          label: `For room ${home.room.label}`,
        }
      : {
          target: null,
          label: `Only residents authorised by the property office can buy for room ${home.room.label}.`,
        };
  }
  const ok = me.purchaseAuthority.some(
    (a) => a.scope === 'FLOOR' && a.floorId === home.room.floor.id,
  );
  return ok
    ? {
        target: { scope: 'FLOOR', floorId: home.room.floor.id },
        label: `For floor ${home.room.floor.label}`,
      }
    : {
        target: null,
        label: `Only residents authorised by the property office can buy for floor ${home.room.floor.label}.`,
      };
}
