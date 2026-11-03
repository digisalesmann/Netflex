export const PAY_STATUS: Record<string, { label: string; tone: string }> = {
  SUCCEEDED: { label: 'Paid', tone: 'ok' },
  PARTIALLY_REFUNDED: { label: 'Part refunded', tone: 'warn' },
  REFUNDED: { label: 'Refunded', tone: 'muted' },
  PENDING: { label: 'Waiting for Paystack', tone: 'info' },
  CREATED: { label: 'Started', tone: 'muted' },
  FAILED: { label: 'Failed', tone: 'bad' },
  ABANDONED: { label: 'Not finished', tone: 'muted' },
  EXPIRED: { label: 'Expired', tone: 'muted' },
};

export const REFUND_STATUS: Record<string, { label: string; tone: string }> = {
  REQUESTED: { label: 'Waiting for approval', tone: 'warn' },
  APPROVED: { label: 'Approved, sending', tone: 'info' },
  SUBMITTED: { label: 'Sent to Paystack', tone: 'info' },
  SUCCEEDED: { label: 'Refunded', tone: 'ok' },
  REJECTED: { label: 'Rejected', tone: 'muted' },
  FAILED: { label: 'Failed', tone: 'bad' },
};

export const MISMATCH: Record<string, string> = {
  PAYMENT_STATE_MISMATCH: 'Paystack and our records disagree about this payment',
  PAYMENT_AMOUNT_MISMATCH: 'Paystack received a different amount than the order',
  LATE_SUCCESS_ON_CLOSED_PAYMENT: 'Paid after the payment had already been closed',
  PAID_WITHOUT_ENTITLEMENT: 'Paid, but no plan was switched on',
  ENTITLEMENT_WITHOUT_PAYMENT: 'A plan is on with no matching payment',
  NETWORK_DRIFT: 'The Wi-Fi equipment disagrees with our records',
  SESSION_WITHOUT_ENTITLEMENT: 'A device is online without a plan',
  EXPIRED_BUT_ACTIVE_ON_GATEWAY: 'An ended plan is still online on the Wi-Fi',
};

/** "2500" from minor units 250000 (no grouping, for form inputs). */
export const major = (minor: string | bigint) => {
  const n = Number(minor) / 100;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
};

export const when = (iso: string) =>
  new Intl.DateTimeFormat('en-NG', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Africa/Lagos',
  }).format(new Date(iso));
