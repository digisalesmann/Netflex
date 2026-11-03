'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { PurchaseTarget } from '@/lib/account';
import { ApiError, api, newIdempotencyKey, store } from '@/lib/api';

/** Steps 2 and 3 of checkout: receipt email, then pay on Paystack. */
export function CheckoutForm({
  planVersionId,
  priceDisplay,
  target,
  renewEntitlementId,
}: {
  planVersionId: string;
  priceDisplay: string;
  target: PurchaseTarget;
  renewEntitlementId?: string;
}) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keys] = useState(() => ({ order: newIdempotencyKey(), checkout: newIdempotencyKey() }));
  const valid = /.+@.+\..+/.test(email);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const o = await api<{ orderId: string; reference: string }>('/orders', {
        method: 'POST',
        headers: { 'idempotency-key': keys.order },
        body: { planVersionId, target, ...(renewEntitlementId ? { renewEntitlementId } : {}) },
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

  return (
    <>
      <section className="co-step" aria-labelledby="co-receipt">
        <span className="co-step__n" aria-hidden="true">
          2
        </span>
        <div className="co-step__body">
          <h2 id="co-receipt" className="co-step__title">
            Receipt
          </h2>
          <p className="co-step__hint">Paystack emails your receipt here.</p>
          <label className="visually-hidden" htmlFor="co-email">
            Email for the Paystack receipt
          </label>
          <input
            id="co-email"
            className="co-input"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
      </section>

      <section className="co-step" aria-labelledby="co-pay">
        <span className="co-step__n" aria-hidden="true">
          3
        </span>
        <div className="co-step__body">
          <h2 id="co-pay" className="co-step__title">
            Pay securely
          </h2>
          <p className="co-step__hint">
            You&apos;ll finish on Paystack&apos;s checkout page. Your access starts only after
            Paystack confirms the payment.
          </p>
          {error ? (
            <p className="co-error" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            className="co-pay"
            disabled={busy || !valid}
            onClick={() => void pay()}
          >
            {busy ? 'Starting payment…' : `Pay ${priceDisplay}`}
          </button>
          {!valid ? (
            <p className="co-step__hint co-step__hint--small">Enter your email to continue.</p>
          ) : null}
          <p className="co-legal">
            By paying you agree to the <Link href="/legal/terms">terms of service</Link> and{' '}
            <Link href="/legal/refunds">refund policy</Link>.
          </p>
        </div>
      </section>
    </>
  );
}
