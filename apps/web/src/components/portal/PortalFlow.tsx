'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, api, newIdempotencyKey, store } from '@/lib/api';
import { duration, remaining, scopeLabel } from '@/lib/format';
import type { PublicPlan } from '@/lib/types';
import { PlanTerms } from '../PlanTerms';
import { SupportForm } from '../SupportForm';
import { Notice, Status } from '../ui';

export interface PortalCtx {
  gw: string;
  ip: string;
  mac: string;
}
interface Property {
  name: string;
  slug: string;
  supportPhone: string | null;
  supportEmail: string | null;
}
interface StatusRes {
  state: string;
  planName?: string | null;
  expiresAt?: string | null;
  expiresAtLocal?: string | null;
  remainingSeconds?: number | null;
}

type View =
  | 'loading'
  | 'gateway-unavailable'
  | 'reconnect'
  | 'welcome'
  | 'voucher'
  | 'plans'
  | 'details'
  | 'review'
  | 'redirecting'
  | 'provisioning'
  | 'connected'
  | 'expired'
  | 'suspended'
  | 'provisioning-failed'
  | 'help';

const VOUCHER_RESULT: Record<string, { tone: 'bad' | 'warn'; title: string; body: string }> = {
  INVALID_VOUCHER: {
    tone: 'bad',
    title: 'That code didn’t work',
    body: 'Check the code and try again. Codes use letters and numbers without 0, 1, I, L or O.',
  },
  VOUCHER_EXHAUSTED: {
    tone: 'warn',
    title: 'This code is already in use on its maximum number of devices',
    body: 'Free a device slot from your account, or ask the person who shared it.',
  },
  EXPIRED: {
    tone: 'warn',
    title: 'This code has expired',
    body: 'Its time has run out or it wasn’t used before its “use by” date. Choose a new plan to continue.',
  },
  SUSPENDED: {
    tone: 'warn',
    title: 'This access is suspended',
    body: 'Contact the property office to find out why.',
  },
  NOT_AUTHORIZED_FOR_GROUP: {
    tone: 'warn',
    title: 'This is a room or floor code',
    body: 'Only residents added to that room or floor plan can use it. Sign in with your phone number, or ask the plan’s manager to add you.',
  },
};

function Heading({
  children,
  refEl,
}: {
  children: ReactNode;
  refEl: React.RefObject<HTMLHeadingElement | null>;
}) {
  return (
    <h1 ref={refEl} tabIndex={-1} style={{ outline: 'none' }}>
      {children}
    </h1>
  );
}

/**
 * Captive portal state machine (spec §12). Every state in the spec has a screen.
 * "Connected" is shown only when the server reports the gateway confirmed it.
 */
export function PortalFlow({ ctx, brand }: { ctx: PortalCtx | null; brand: string }) {
  const [view, setView] = useState<View>('loading');
  const [property, setProperty] = useState<Property | null>(null);
  const [status, setStatus] = useState<StatusRes | null>(null);
  const [plans, setPlans] = useState<PublicPlan[] | null>(null);
  const [plan, setPlan] = useState<PublicPlan | null>(null);
  const [buyer, setBuyer] = useState<{ phone: string; email: string }>({ phone: '', email: '' });
  const [voucherError, setVoucherError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const pollStarted = useRef<number | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const go = useCallback((v: View) => {
    setError(null);
    setView(v);
  }, []);

  // Move focus to each new step's heading (screen readers, keyboards); not on first load.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    heading.current?.focus();
  }, [view]);

  const applyStatus = useCallback(
    (s: StatusRes) => {
      setStatus(s);
      switch (s.state) {
        case 'GATEWAY_UNAVAILABLE':
          return go('gateway-unavailable');
        case 'RECONNECT_REQUIRED':
          return go('reconnect');
        case 'ACCESS_BEING_CONFIGURED':
        case 'VOUCHER_AVAILABLE':
          return go('provisioning');
        case 'CONNECTED':
        case 'CONNECTED_EXPIRING_SOON':
          return go('connected');
        case 'ACCESS_SUSPENDED':
          return go('suspended');
        case 'SUBSCRIPTION_EXPIRED':
        case 'ACCESS_REVOKED':
          return go('expired');
        case 'PROVISIONING_NEEDS_ATTENTION':
          return go('provisioning-failed');
        default:
          return go('welcome');
      }
    },
    [go],
  );

  const refresh = useCallback(async () => {
    if (!ctx) return go('reconnect');
    try {
      applyStatus(await api<StatusRes>('/portal/status', { method: 'POST', body: ctx }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the service.');
      go('gateway-unavailable');
    }
  }, [ctx, applyStatus, go]);

  useEffect(() => {
    if (!ctx) {
      go('reconnect');
      return;
    }
    store.set('nf:portal-ctx', ctx, 6 * 3600_000);
    void (async () => {
      try {
        const c = await api<{ gateway: string; property: Property | null }>('/portal/context', {
          method: 'POST',
          body: ctx,
        });
        setProperty(c.property);
      } catch {
        /* the status call below reports the problem */
      }
      await refresh();
    })();
  }, [ctx, refresh, go]);

  // Poll while access is being switched on; after 3 minutes, say so and offer help.
  useEffect(() => {
    if (view !== 'provisioning') {
      pollStarted.current = null;
      setSlow(false);
      return;
    }
    pollStarted.current ??= Date.now();
    const t = setInterval(() => {
      if (pollStarted.current && Date.now() - pollStarted.current > 180_000) setSlow(true);
      void refresh();
    }, 3000);
    return () => clearInterval(t);
  }, [view, refresh]);

  async function loadPlans() {
    go('plans');
    if (plans || !property) return;
    try {
      setPlans(await api<PublicPlan[]>(`/catalog/properties/${property.slug}/plans`));
    } catch {
      setError('Plans could not be loaded. Try again.');
    }
  }

  async function redeem(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!ctx) return;
    const code = String(new FormData(e.currentTarget).get('code') ?? '');
    setBusy(true);
    setVoucherError(null);
    try {
      const r = await api<{ state: string }>('/portal/redeem', {
        method: 'POST',
        body: { ...ctx, code },
      });
      if (r.state === 'ACCESS_BEING_CONFIGURED') go('provisioning');
      else if (r.state === 'GATEWAY_UNAVAILABLE') go('gateway-unavailable');
      else if (r.state === 'RECONNECT_REQUIRED') go('reconnect');
      else setVoucherError(r.state);
    } catch (err) {
      setVoucherError(
        err instanceof ApiError && err.code === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'ERROR',
      );
    } finally {
      setBusy(false);
    }
  }

  async function pay() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      // Same keys on retry → the server returns the same order/attempt instead of a duplicate.
      const saved = store.get<{ orderKey: string; checkoutKey: string; planVersionId: string }>(
        'nf:attempt',
      );
      const keys =
        saved?.planVersionId === plan.planVersionId
          ? saved
          : {
              orderKey: newIdempotencyKey(),
              checkoutKey: newIdempotencyKey(),
              planVersionId: plan.planVersionId,
            };
      store.set('nf:attempt', keys, 3600_000);
      const order = await api<{ orderId: string; reference: string; accessToken?: string }>(
        '/orders',
        {
          method: 'POST',
          headers: { 'idempotency-key': keys.orderKey },
          body: {
            planVersionId: plan.planVersionId,
            target: { scope: 'INDIVIDUAL' },
            customerPhone: buyer.phone,
          },
        },
      );
      store.set(
        'nf:checkout',
        {
          orderId: order.orderId,
          reference: order.reference,
          token: order.accessToken ?? null,
          ctx,
        },
        72 * 3600_000,
      );
      const checkout = await api<{ checkoutUrl: string }>(`/orders/${order.orderId}/checkout`, {
        method: 'POST',
        headers: {
          'idempotency-key': keys.checkoutKey,
          ...(order.accessToken ? { 'x-order-token': order.accessToken } : {}),
        },
        body: { email: buyer.email },
      });
      store.remove('nf:attempt');
      go('redirecting');
      window.location.assign(checkout.checkoutUrl);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Payment could not be started. You have not been charged.',
      );
    } finally {
      setBusy(false);
    }
  }

  const back = (to: View) => (
    <button type="button" className="linkbutton" onClick={() => go(to)}>
      ← Back
    </button>
  );
  const helpLink = (
    <p className="small" style={{ marginTop: 'var(--nf-space-6)' }}>
      <button type="button" className="linkbutton" onClick={() => go('help')}>
        Need help?
      </button>
    </p>
  );
  const individual = plans?.filter((p) => p.scope === 'INDIVIDUAL') ?? [];

  return (
    <div className="portal">
      <p className="eyebrow">{property ? `${brand} · ${property.name}` : brand}</p>
      <div aria-live="polite">{error ? <Notice tone="bad">{error}</Notice> : null}</div>

      {view === 'loading' ? (
        <>
          <Heading refEl={heading}>Checking your connection</Heading>
          <p className="status status--info">One moment…</p>
        </>
      ) : null}

      {view === 'reconnect' ? (
        <>
          <Heading refEl={heading}>Reconnect to the Wi-Fi</Heading>
          <p>
            We couldn&apos;t confirm your device on the property network. Make sure you&apos;re
            connected to the property Wi-Fi, then open any website to come back to this page.
          </p>
          <p className="muted small">
            This page only works while you&apos;re on the property Wi-Fi, not from a bookmark or
            another network.
          </p>
          {helpLink}
        </>
      ) : null}

      {view === 'gateway-unavailable' ? (
        <>
          <Heading refEl={heading}>Wi-Fi sign-in is temporarily unavailable</Heading>
          <p>
            The property network isn&apos;t responding to us right now, so we can&apos;t switch
            access on. Your paid time and existing codes are safe.
          </p>
          <div className="actions">
            <button type="button" className="button" onClick={() => void refresh()}>
              Try again
            </button>
          </div>
          {helpLink}
        </>
      ) : null}

      {view === 'welcome' ? (
        <>
          <Heading refEl={heading}>Get online</Heading>
          <p>Enter a voucher code, or choose a plan and pay with Paystack.</p>
          <div className="actions">
            <button type="button" className="button" onClick={() => go('voucher')}>
              I have a voucher
            </button>
            <button type="button" className="button button--quiet" onClick={() => void loadPlans()}>
              Choose a plan
            </button>
          </div>
          <p className="small muted" style={{ marginTop: 'var(--nf-space-5)' }}>
            Already paid? <a href="/checkout/return">Check your payment</a>.
          </p>
          {helpLink}
        </>
      ) : null}

      {view === 'voucher' ? (
        <>
          {back('welcome')}
          <Heading refEl={heading}>Enter your voucher</Heading>
          <div aria-live="polite">
            {voucherError && VOUCHER_RESULT[voucherError] ? (
              <Notice
                tone={VOUCHER_RESULT[voucherError].tone}
                title={VOUCHER_RESULT[voucherError].title}
              >
                <p>{VOUCHER_RESULT[voucherError].body}</p>
              </Notice>
            ) : voucherError === 'RATE_LIMITED' ? (
              <Notice tone="warn" title="Too many attempts">
                <p>Please wait a while before trying again.</p>
              </Notice>
            ) : voucherError ? (
              <Notice tone="bad">Something went wrong. Try again.</Notice>
            ) : null}
          </div>
          <form onSubmit={(e) => void redeem(e)} noValidate>
            <div className="field">
              <label htmlFor="code">Voucher code</label>
              <span className="hint" id="code-hint">
                12 letters and numbers, e.g. ABCD-EFGH-JKMN
              </span>
              <input
                id="code"
                name="code"
                className="code-input"
                required
                autoComplete="one-time-code"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={20}
                aria-describedby="code-hint"
                aria-invalid={voucherError ? true : undefined}
              />
            </div>
            <button className="button button--block" type="submit" disabled={busy}>
              {busy ? 'Checking…' : 'Connect'}
            </button>
          </form>
          {helpLink}
        </>
      ) : null}

      {view === 'plans' ? (
        <>
          {back('welcome')}
          <Heading refEl={heading}>Choose a plan</Heading>
          {!plans ? (
            <p className="status status--info">Loading plans…</p>
          ) : individual.length === 0 ? (
            <Notice>No plans are on sale right now. Ask at the property office.</Notice>
          ) : (
            <ul className="rows">
              {individual.map((p) => (
                <li key={p.planVersionId}>
                  <div className="row-head">
                    <strong>{p.name}</strong>
                    <span className="plan-price">{p.price.display}</span>
                  </div>
                  <p className="muted small">
                    {duration(p.duration)} · up to {p.maxDevices} device
                    {p.maxDevices === 1 ? '' : 's'}
                  </p>
                  <button
                    type="button"
                    className="button button--quiet"
                    onClick={() => {
                      setPlan(p);
                      go('details');
                    }}
                    aria-label={`Choose ${p.name}, ${p.price.display}`}
                  >
                    Choose
                  </button>
                </li>
              ))}
            </ul>
          )}
          {plans?.some((p) => p.scope !== 'INDIVIDUAL') ? (
            <p className="small muted" style={{ marginTop: 'var(--nf-space-4)' }}>
              {scopeLabel.ROOM} and {scopeLabel.FLOOR.toLowerCase()} plans are available to
              authorised residents from <a href="/account/plans">your account</a>.
            </p>
          ) : null}
          {helpLink}
        </>
      ) : null}

      {view === 'details' && plan ? (
        <>
          {back('plans')}
          <Heading refEl={heading}>Your details</Heading>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBuyer({
                phone: String(f.get('phone') ?? ''),
                email: String(f.get('email') ?? ''),
              });
              go('review');
            }}
          >
            <div className="field">
              <label htmlFor="phone">Phone number</label>
              <span className="hint" id="phone-hint">
                For your receipt and if you need help. We don&apos;t send marketing.
              </span>
              <input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                required
                defaultValue={buyer.phone}
                aria-describedby="phone-hint"
                placeholder="0803 000 0000"
              />
            </div>
            <div className="field">
              <label htmlFor="email">Email for the Paystack receipt</label>
              <input
                id="email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                defaultValue={buyer.email}
              />
            </div>
            <button className="button button--block" type="submit">
              Review
            </button>
          </form>
        </>
      ) : null}

      {view === 'review' && plan ? (
        <>
          {back('details')}
          <Heading refEl={heading}>Review your purchase</Heading>
          <p>
            <strong>{plan.name}</strong>
          </p>
          <PlanTerms plan={plan} />
          <dl className="facts">
            <dt>Phone</dt>
            <dd>{buyer.phone}</dd>
            <dt>Receipt to</dt>
            <dd>{buyer.email}</dd>
          </dl>
          <p className="small muted">
            By paying you agree to the{' '}
            <a href="/legal/terms" target="_blank" rel="noreferrer">
              terms
            </a>{' '}
            and{' '}
            <a href="/legal/refunds" target="_blank" rel="noreferrer">
              refund policy
            </a>
            . You&apos;ll be taken to Paystack to pay; we never see your card details.
          </p>
          <button
            type="button"
            className="button button--block"
            disabled={busy}
            onClick={() => void pay()}
          >
            {busy ? 'Starting payment…' : `Pay ${plan.price.display}`}
          </button>
        </>
      ) : null}

      {view === 'redirecting' ? (
        <>
          <Heading refEl={heading}>Opening Paystack…</Heading>
          <p>
            If nothing happens, your phone may have closed the sign-in window. Open your browser and
            go to the &quot;Check your payment&quot; page.
          </p>
        </>
      ) : null}

      {view === 'provisioning' ? (
        <>
          <Heading refEl={heading}>Switching on your access</Heading>
          <p className="status status--info">
            <span className="spinner" aria-hidden="true" /> Waiting for the property network to
            confirm your device. This usually takes a moment.
          </p>
          {slow ? (
            <Notice tone="warn" title="This is taking longer than usual">
              <p>
                Your access is safe and we&apos;ll keep trying automatically. You can close this
                page and check back, or contact support.
              </p>
            </Notice>
          ) : null}
          {helpLink}
        </>
      ) : null}

      {view === 'connected' && status ? (
        <>
          <Heading refEl={heading}>You&apos;re connected</Heading>
          <p>
            <Status tone={status.state === 'CONNECTED_EXPIRING_SOON' ? 'warn' : 'ok'}>
              {status.state === 'CONNECTED_EXPIRING_SOON' ? 'Connected · ending soon' : 'Connected'}
            </Status>
          </p>
          <dl className="facts">
            {status.planName ? (
              <>
                <dt>Plan</dt>
                <dd>{status.planName}</dd>
              </>
            ) : null}
            <dt>Time left</dt>
            <dd>{remaining(status.remainingSeconds ?? null)}</dd>
            {status.expiresAtLocal ? (
              <>
                <dt>Ends</dt>
                <dd>{status.expiresAtLocal}</dd>
              </>
            ) : null}
          </dl>
          <p>
            You can close this window and browse normally. Manage your devices and renew from{' '}
            <a href="/account">your account</a>.
          </p>
        </>
      ) : null}

      {view === 'expired' ? (
        <>
          <Heading refEl={heading}>Your access has ended</Heading>
          <p>
            The time on this device&apos;s plan has run out, or it was cancelled. Choose a new plan
            to continue.
          </p>
          <div className="actions">
            <button type="button" className="button" onClick={() => void loadPlans()}>
              Choose a plan
            </button>
            <button type="button" className="button button--quiet" onClick={() => go('voucher')}>
              Enter another voucher
            </button>
          </div>
        </>
      ) : null}

      {view === 'suspended' ? (
        <>
          <Heading refEl={heading}>Your access is suspended</Heading>
          <p>
            The property has paused access for this plan. Contact the property office to find out
            why.
          </p>
          {helpLink}
        </>
      ) : null}

      {view === 'provisioning-failed' ? (
        <>
          <Heading refEl={heading}>We&apos;re having trouble switching on your access</Heading>
          <p>
            Your payment and plan are safe. The network didn&apos;t confirm your device; staff have
            been alerted and we&apos;ll retry. You won&apos;t be charged again.
          </p>
          <div className="actions">
            <button type="button" className="button" onClick={() => void refresh()}>
              Check again
            </button>
          </div>
          {helpLink}
        </>
      ) : null}

      {view === 'help' ? (
        <>
          <button type="button" className="linkbutton" onClick={() => void refresh()}>
            ← Back
          </button>
          <Heading refEl={heading}>Help and recovery</Heading>
          <ul className="rows">
            <li>
              <strong>Page closed during payment?</strong> Open your browser and go to{' '}
              <a href="/checkout/return">check your payment</a>.
            </li>
            <li>
              <strong>Lost your code?</strong> If you bought it, the payment page shows it until
              first use. Otherwise ask support to reissue it.
            </li>
            <li>
              <strong>Device refused after a phone change?</strong> Turn off &quot;private Wi-Fi
              address&quot; for this network, or free a device slot in your account.
            </li>
            <li>
              <strong>This page looks broken?</strong> Copy this page&apos;s address and open it in
              your normal browser.
            </li>
          </ul>
          {property ? (
            <>
              <p style={{ marginTop: 'var(--nf-space-5)' }}>
                Property office:{' '}
                {property.supportPhone ? (
                  <a href={`tel:${property.supportPhone}`}>{property.supportPhone}</a>
                ) : (
                  'ask at reception'
                )}
              </p>
              <h2 className="h3">Send a message</h2>
              <SupportForm propertySlug={property.slug} signedIn={false} />
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
