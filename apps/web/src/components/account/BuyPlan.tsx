'use client';

import { useState } from 'react';
import { ApiError, api, newIdempotencyKey, store } from '@/lib/api';
import type { PublicPlan } from '@/lib/types';
import { PlanTerms } from '../PlanTerms';
import { Notice } from '../ui';

type Target =
  { scope: 'INDIVIDUAL' } | { scope: 'ROOM'; roomId: string } | { scope: 'FLOOR'; floorId: string };

export function BuyPlan({
  plan,
  target,
  targetLabel,
  renewEntitlementId,
}: {
  plan: PublicPlan;
  target: Target | null;
  targetLabel: string;
  renewEntitlementId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keys] = useState(() => ({ order: newIdempotencyKey(), checkout: newIdempotencyKey() }));

  async function pay() {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const o = await api<{ orderId: string; reference: string }>('/orders', {
        method: 'POST',
        headers: { 'idempotency-key': keys.order },
        body: {
          planVersionId: plan.planVersionId,
          target,
          ...(renewEntitlementId ? { renewEntitlementId } : {}),
        },
      });
      store.set(
        'nf:checkout',
        {
          orderId: o.orderId,
          reference: o.reference,
          token: null,
          ctx: store.get('nf:portal-ctx'),
        },
        72 * 3600_000,
      );
      const c = await api<{ checkoutUrl: string }>(`/orders/${o.orderId}/checkout`, {
        method: 'POST',
        headers: { 'idempotency-key': keys.checkout },
        body: { email },
      });
      window.location.assign(c.checkoutUrl);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : 'Payment could not be started. You have not been charged.',
      );
      setBusy(false);
    }
  }

  if (!target) return <p className="small muted">{targetLabel}</p>;
  if (!open) {
    return (
      <span className="actions" style={{ marginTop: 0, alignItems: 'center' }}>
        <button type="button" className="button button--quiet" onClick={() => setOpen(true)}>
          {renewEntitlementId ? 'Renew' : 'Buy'} {plan.name}
        </button>
        <span className="small muted">{targetLabel}</span>
      </span>
    );
  }
  return (
    <div style={{ marginTop: 'var(--nf-space-3)' }}>
      <h3 className="h3">Review</h3>
      <PlanTerms plan={plan} />
      {renewEntitlementId ? (
        <p className="small">
          Renewal: the new time is added after your current plan ends; nothing is lost.
        </p>
      ) : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <div className="field">
        <label htmlFor={`email-${plan.planVersionId}`}>Email for the Paystack receipt</label>
        <input
          id={`email-${plan.planVersionId}`}
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div className="actions">
        <button
          type="button"
          className="button"
          disabled={busy || !/.+@.+\..+/.test(email)}
          onClick={() => void pay()}
        >
          {busy ? 'Starting payment…' : `Pay ${plan.price.display}`}
        </button>
        <button type="button" className="button button--quiet" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
