import { redirect } from 'next/navigation';
import { serverApi } from './server-api';

export interface Me {
  user: { id: string; kind: 'STAFF' | 'TENANT'; displayName: string; phoneE164: string | null };
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
    phoneSuffix: string;
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
