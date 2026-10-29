export interface PublicPlan {
  planId: string;
  planVersionId: string;
  slug: string;
  name: string;
  description: string;
  scope: 'INDIVIDUAL' | 'ROOM' | 'FLOOR';
  price: { amountMinor: string; currency: string; display: string };
  duration: { value: number; unit: string };
  activationPolicy: 'ON_PURCHASE' | 'ON_FIRST_REDEMPTION' | 'ON_FIRST_AUTHORIZATION';
  redemptionWindow: { value: number; unit: string } | null;
  maxDevices: number;
  maxConcurrentSessions: number;
  speed: { downloadKbps: number | null; uploadKbps: number | null; guaranteed: boolean };
  maxGroupMembers: number | null;
  renewalRule: string;
  fairUseText: string | null;
  refundPolicyText: string;
  termsVersion: string;
}

export interface PublicProperty {
  name: string;
  slug: string;
  timeZone: string;
  currency: string;
  supportPhone: string | null;
  supportEmail: string | null;
}
