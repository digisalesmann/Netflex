'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, store } from '@/lib/api';
import { Notice, Status } from '../ui';
import type { PortalCtx } from './PortalFlow';

interface OrderView {
  orderId: string;
  reference: string;
  stage: string;
  planName: string;
  amount: { display: string };
  voucherAvailable: boolean;
}
interface Saved {
  orderId: string;
  reference: string;
  token: string | null;
  ctx: PortalCtx | null;
}

/**
 * After Paystack. The redirect proves nothing: this page asks NetFlex, which asks
 * Paystack directly. States: payment pending, failed, confirmed, voucher issued.
 */
export function CheckoutReturn({ orderIdFromUrl }: { orderIdFromUrl: string | null }) {
  const [saved, setSaved] = useState<Saved | null>(null);
  const [order, setOrder] = useState<OrderView | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);
  const polls = useRef(0);

  useEffect(() => {
    const s = store.get<Saved>('nf:checkout');
    if (s && (!orderIdFromUrl || s.orderId === orderIdFromUrl)) setSaved(s);
    else if (orderIdFromUrl)
      setSaved({
        orderId: orderIdFromUrl,
        reference: '',
        token: null,
        ctx: store.get<PortalCtx>('nf:portal-ctx'),
      });
    else setMissing(true);
  }, [orderIdFromUrl]);

  const headers = useCallback(
    (): Record<string, string> => (saved?.token ? { 'x-order-token': saved.token } : {}),
    [saved],
  );

  const load = useCallback(
    async (verify: boolean) => {
      if (!saved) return;
      try {
        const o = verify
          ? await api<OrderView>(`/orders/${saved.orderId}/payment/verify`, {
              method: 'POST',
              headers: headers(),
            })
          : await api<OrderView>(`/orders/${saved.orderId}`, { headers: headers() });
        setOrder(o);
        setError(null);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) setMissing(true);
        else setError(e instanceof ApiError ? e.message : 'Could not check the payment.');
      }
    },
    [saved, headers],
  );

  // First check asks Paystack; then poll gently while pending or waiting for the voucher.
  useEffect(() => {
    if (!saved) return;
    void load(true);
  }, [saved, load]);
  useEffect(() => {
    if (
      !order ||
      !['PAYMENT_PENDING', 'PAYMENT_CONFIRMED'].includes(order.stage) ||
      polls.current > 40
    )
      return;
    const t = setTimeout(() => {
      polls.current++;
      void load(polls.current % 4 === 0);
    }, 3000);
    return () => clearTimeout(t);
  }, [order, load]);

  async function reveal() {
    if (!saved) return;
    setBusy(true);
    try {
      const r = await api<{ code: string }>(`/orders/${saved.orderId}/voucher`, {
        method: 'POST',
        headers: headers(),
      });
      setCode(r.code);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not show the code.');
    } finally {
      setBusy(false);
    }
  }

  async function connectHere() {
    if (!saved?.ctx || !code) return;
    setBusy(true);
    try {
      const r = await api<{ state: string }>('/portal/redeem', {
        method: 'POST',
        body: { ...saved.ctx, code },
      });
      if (r.state === 'ACCESS_BEING_CONFIGURED' || r.state === 'VOUCHER_EXHAUSTED') {
        const u = new URL('/connect', window.location.origin);
        Object.entries(saved.ctx).forEach(([k, v]) => u.searchParams.set(k, v));
        store.remove('nf:checkout');
        window.location.assign(u.toString());
      } else if (r.state === 'RECONNECT_REQUIRED' || r.state === 'GATEWAY_UNAVAILABLE') {
        setError(
          'This device is not on the property Wi-Fi right now. Connect to the Wi-Fi and enter the code on the sign-in page.',
        );
      } else {
        setError('The code could not be applied. Contact support with your order reference.');
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not connect this device.');
    } finally {
      setBusy(false);
    }
  }

  if (missing) {
    return (
      <>
        <h1>We can&apos;t find your payment on this device</h1>
        <p>
          This page keeps track of payments made in this browser. If you paid elsewhere or the page
          was cleared:
        </p>
        <ul className="rows">
          <li>
            Signed in? Your orders are in <a href="/account/orders">your account</a>.
          </li>
          <li>
            Guest purchase? Contact support with the order reference (NFX-…) from your Paystack
            receipt email. Don&apos;t pay again.
          </li>
        </ul>
        <p style={{ marginTop: 'var(--nf-space-5)' }}>
          <a className="button" href="/contact">
            Contact support
          </a>
        </p>
      </>
    );
  }

  if (!order) {
    return (
      <>
        <h1>Checking your payment</h1>
        {error ? (
          <Notice tone="bad">{error}</Notice>
        ) : (
          <p className="status status--info">Asking Paystack…</p>
        )}
      </>
    );
  }

  return (
    <>
      <h1>
        {order.stage === 'VOUCHER_AVAILABLE'
          ? code
            ? 'Your voucher code'
            : 'Payment confirmed'
          : order.stage === 'PAYMENT_CONFIRMED'
            ? 'Payment confirmed'
            : order.stage === 'PAYMENT_FAILED'
              ? 'Payment didn’t go through'
              : order.stage === 'PAID'
                ? 'Payment confirmed'
                : order.stage === 'EXPIRED' || order.stage === 'CANCELLED'
                  ? 'This order has expired'
                  : order.stage === 'REFUNDED'
                    ? 'This order was refunded'
                    : 'Payment pending'}
      </h1>
      <div aria-live="polite">{error ? <Notice tone="bad">{error}</Notice> : null}</div>
      <dl className="facts">
        <dt>Order</dt>
        <dd>{order.reference}</dd>
        <dt>Plan</dt>
        <dd>{order.planName}</dd>
        <dt>Amount</dt>
        <dd>{order.amount.display}</dd>
        <dt>Status</dt>
        <dd>
          {order.stage === 'PAYMENT_PENDING' ? (
            <Status tone="info">Waiting for Paystack</Status>
          ) : order.stage === 'PAYMENT_FAILED' ? (
            <Status tone="bad">Not paid</Status>
          ) : order.stage === 'VOUCHER_AVAILABLE' ||
            order.stage === 'PAYMENT_CONFIRMED' ||
            order.stage === 'PAID' ? (
            <Status tone="ok">Paid</Status>
          ) : (
            <Status tone="warn">{order.stage.toLowerCase()}</Status>
          )}
        </dd>
      </dl>

      {order.stage === 'PAYMENT_PENDING' ? (
        <>
          <p>
            We haven&apos;t received confirmation from Paystack yet. If you completed the payment,
            this usually takes a moment. Don&apos;t pay again.
          </p>
          <button type="button" className="button" onClick={() => void load(true)}>
            Check again
          </button>
        </>
      ) : null}

      {order.stage === 'PAYMENT_FAILED' ? (
        <>
          <p>
            Paystack reported that the payment wasn&apos;t completed. You have not been charged for
            this attempt.
          </p>
          <a
            className="button"
            href={
              saved?.ctx
                ? `/connect?gw=${saved.ctx.gw}&ip=${saved.ctx.ip}&mac=${saved.ctx.mac}`
                : '/plans'
            }
          >
            Try again
          </a>
        </>
      ) : null}

      {order.stage === 'PAYMENT_CONFIRMED' ? (
        <p className="status status--info">Preparing your voucher…</p>
      ) : null}

      {order.stage === 'VOUCHER_AVAILABLE' && !code ? (
        <>
          <p>Your voucher is ready. It&apos;s shown only to you, until you first use it.</p>
          <button type="button" className="button" onClick={() => void reveal()} disabled={busy}>
            Show my code
          </button>
        </>
      ) : null}

      {code ? (
        <>
          <p className="voucher-code" aria-label={`Voucher code ${code.split('').join(' ')}`}>
            {code}
          </p>
          <Notice tone="warn">
            <p>
              Keep this code private: anyone with it can use your access. Write it down; it
              won&apos;t be shown again after you use it.
            </p>
          </Notice>
          <div className="actions">
            {saved?.ctx ? (
              <button
                type="button"
                className="button"
                onClick={() => void connectHere()}
                disabled={busy}
              >
                Connect this device
              </button>
            ) : null}
            <button
              type="button"
              className="button button--quiet"
              onClick={() => void navigator.clipboard?.writeText(code)}
            >
              Copy code
            </button>
          </div>
          {!saved?.ctx ? (
            <p className="muted small">
              To connect, join the property Wi-Fi and enter this code on the sign-in page.
            </p>
          ) : null}
        </>
      ) : null}

      {order.stage === 'EXPIRED' || order.stage === 'CANCELLED' ? (
        <p>
          It wasn&apos;t paid in time. If you were charged, contact <a href="/contact">support</a>{' '}
          with the reference above; otherwise start a new purchase.
        </p>
      ) : null}
    </>
  );
}
