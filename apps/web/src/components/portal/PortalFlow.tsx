'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, api, newIdempotencyKey, store } from '@/lib/api';
import { duration, remaining, scopeLabel } from '@/lib/format';
import { sortPlans } from '@/lib/plans';
import type { PublicPlan } from '@/lib/types';
import { Logo } from '../Logo';
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

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}

const BUY_STEPS = ['Plan', 'Details', 'Review', 'Pay'] as const;
function Steps({ at }: { at: number }) {
  return (
    <ol className="cn-steps" aria-label={`Step ${at + 1} of ${BUY_STEPS.length}`}>
      {BUY_STEPS.map((s, i) => (
        <li key={s} data-state={i < at ? 'done' : i === at ? 'now' : 'todo'}>
          <span aria-hidden="true" />
          {s}
        </li>
      ))}
    </ol>
  );
}

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
export function PortalFlow({ ctx }: { ctx: PortalCtx | null }) {
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
    <button type="button" className="cn-back" onClick={() => go(to)}>
      <Icon d="M19 12H6M11 6.5 5.5 12 11 17.5" />
      Back
    </button>
  );
  const helpLink = (
    <p className="cn-help">
      <button type="button" className="cn-help__btn" onClick={() => go('help')}>
        <Icon d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4v.3M12 16.5h.01" />
        Need help?
      </button>
    </p>
  );
  const individual = sortPlans(plans?.filter((p) => p.scope === 'INDIVIDUAL') ?? []);

  return (
    <div className="cn" data-view={view}>
      <header className="cn-head">
        <Logo />
        {property ? (
          <p className="cn-venue">
            <span className="cn-venue__dot" aria-hidden="true" />
            Wi-Fi at {property.name}
          </p>
        ) : null}
      </header>
      <div aria-live="polite">{error ? <Notice tone="bad">{error}</Notice> : null}</div>
      <div className="cn-body" key={view}>
        {view === 'loading' ? (
          <>
            <Heading refEl={heading}>Checking your connection</Heading>
            <div className="cn-signal" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <p className="cn-lede">One moment…</p>
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
            <div className="cn-actions">
              <button type="button" className="cn-btn" onClick={() => void refresh()}>
                Try again
              </button>
            </div>
            {helpLink}
          </>
        ) : null}

        {view === 'welcome' ? (
          <>
            <Heading refEl={heading}>Get online</Heading>
            <p className="cn-lede">Enter a voucher code, or choose a plan and pay with Paystack.</p>
            <div className="cn-choices">
              <button type="button" className="cn-choice" onClick={() => go('voucher')}>
                <span className="cn-choice__icon">
                  <Icon d="M5.5 6h13A1.5 1.5 0 0 1 20 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5V14a2 2 0 0 0 0-4V7.5A1.5 1.5 0 0 1 5.5 6zM14.5 6.5v1.5M14.5 11.25v1.5M14.5 16v1.5" />
                </span>
                <span className="cn-choice__text">
                  <strong>I have a voucher</strong>
                  <span>Enter your code to connect</span>
                </span>
                <Icon d="M9 5.5 15.5 12 9 18.5" />
              </button>
              <button type="button" className="cn-choice" onClick={() => void loadPlans()}>
                <span className="cn-choice__icon">
                  <Icon d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
                </span>
                <span className="cn-choice__text">
                  <strong>Choose a plan</strong>
                  <span>Pay securely with Paystack</span>
                </span>
                <Icon d="M9 5.5 15.5 12 9 18.5" />
              </button>
            </div>
            <p className="cn-small">
              Already paid? <a href="/checkout/return">Check your payment</a>
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
              <div className="field cn-field">
                <label htmlFor="code">Voucher code</label>
                <span className="hint" id="code-hint">
                  12 letters and numbers, e.g. ABCD-EFGH-JKMN
                </span>
                <input
                  id="code"
                  name="code"
                  className="code-input cn-code"
                  required
                  autoComplete="one-time-code"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={20}
                  placeholder="XXXX-XXXX-XXXX"
                  aria-describedby="code-hint"
                  aria-invalid={voucherError ? true : undefined}
                />
              </div>
              <button className="cn-btn" type="submit" disabled={busy}>
                {busy ? 'Checking…' : 'Connect'}
              </button>
            </form>
            {helpLink}
          </>
        ) : null}

        {view === 'plans' ? (
          <>
            {back('welcome')}
            <Steps at={0} />
            <Heading refEl={heading}>Choose a plan</Heading>
            {!plans ? (
              <p className="status status--info">Loading plans…</p>
            ) : individual.length === 0 ? (
              <Notice>No plans are on sale right now. Ask at the property office.</Notice>
            ) : (
              <ul className="cn-plans">
                {individual.map((p) => (
                  <li key={p.planVersionId}>
                    <button
                      type="button"
                      className="cn-plan"
                      onClick={() => {
                        setPlan(p);
                        go('details');
                      }}
                      aria-label={`Choose ${p.name}, ${p.price.display}`}
                    >
                      <span className="cn-plan__main">
                        <strong>{p.name}</strong>
                        <span>
                          {duration(p.duration)} · up to {p.maxDevices} device
                          {p.maxDevices === 1 ? '' : 's'}
                        </span>
                      </span>
                      <span className="cn-plan__price">{p.price.display}</span>
                      <Icon d="M9 5.5 15.5 12 9 18.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {plans?.some((p) => p.scope !== 'INDIVIDUAL') ? (
              <p className="cn-small">
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
            <Steps at={1} />
            <Heading refEl={heading}>Your details</Heading>
            <p className="cn-lede">
              {plan.name} · {plan.price.display}
            </p>
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
              <button className="cn-btn" type="submit">
                Review
              </button>
            </form>
          </>
        ) : null}

        {view === 'review' && plan ? (
          <>
            {back('details')}
            <Steps at={2} />
            <Heading refEl={heading}>Review your purchase</Heading>
            <div className="receipt cn-receipt">
              <div className="receipt__paper">
                <div className="receipt__item">
                  <div>
                    <p className="receipt__name">{plan.name}</p>
                    <p className="receipt__meta">Just you · {duration(plan.duration)}</p>
                  </div>
                  <p className="receipt__amt">{plan.price.display}</p>
                </div>
                <hr className="receipt__tear" />
                <PlanTerms plan={plan} />
                <hr className="receipt__tear" />
                <dl className="receipt__lines">
                  <div>
                    <dt>Phone</dt>
                    <dd>{buyer.phone}</dd>
                  </div>
                  <div>
                    <dt>Receipt to</dt>
                    <dd>{buyer.email}</dd>
                  </div>
                </dl>
                <hr className="receipt__tear" />
                <dl className="receipt__lines receipt__lines--total">
                  <div>
                    <dt>Total</dt>
                    <dd>{plan.price.display}</dd>
                  </div>
                </dl>
              </div>
            </div>
            <p className="cn-small">
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
            <button type="button" className="cn-btn" disabled={busy} onClick={() => void pay()}>
              {busy ? 'Starting payment…' : `Pay ${plan.price.display}`}
            </button>
          </>
        ) : null}

        {view === 'redirecting' ? (
          <>
            <Steps at={3} />
            <div className="cn-signal" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <Heading refEl={heading}>Opening Paystack…</Heading>
            <p>
              If nothing happens, your phone may have closed the sign-in window. Open your browser
              and go to the &quot;Check your payment&quot; page.
            </p>
          </>
        ) : null}

        {view === 'provisioning' ? (
          <>
            <div className="cn-signal" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <Heading refEl={heading}>Switching on your access</Heading>
            <p className="cn-lede">
              Waiting for the property network to confirm your device. This usually takes a moment.
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
            <div className="cn-done" aria-hidden="true">
              <svg viewBox="0 0 52 52">
                <circle cx="26" cy="26" r="24" />
                <path d="M15 27 23 35 38 18" />
              </svg>
            </div>
            <Heading refEl={heading}>You&apos;re connected</Heading>
            <p>
              <Status tone={status.state === 'CONNECTED_EXPIRING_SOON' ? 'warn' : 'ok'}>
                {status.state === 'CONNECTED_EXPIRING_SOON'
                  ? 'Connected · ending soon'
                  : 'Connected'}
              </Status>
            </p>
            <div className="cn-time">
              <p className="cn-time__big">{remaining(status.remainingSeconds ?? null)}</p>
              <dl className="cn-time__facts">
                {status.planName ? (
                  <div>
                    <dt>Plan</dt>
                    <dd>{status.planName}</dd>
                  </div>
                ) : null}
                {status.expiresAtLocal ? (
                  <div>
                    <dt>Ends</dt>
                    <dd>{status.expiresAtLocal}</dd>
                  </div>
                ) : null}
              </dl>
            </div>
            <p className="cn-lede">
              You can close this window and browse normally. Manage your devices and renew from{' '}
              <a href="/account">your account</a>.
            </p>
          </>
        ) : null}

        {view === 'expired' ? (
          <>
            <Heading refEl={heading}>Your access has ended</Heading>
            <p>
              The time on this device&apos;s plan has run out, or it was cancelled. Choose a new
              plan to continue.
            </p>
            <div className="cn-actions">
              <button type="button" className="cn-btn" onClick={() => void loadPlans()}>
                Choose a plan
              </button>
              <button type="button" className="cn-btn cn-btn--ghost" onClick={() => go('voucher')}>
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
              Your payment and plan are safe. The network didn&apos;t confirm your device; staff
              have been alerted and we&apos;ll retry. You won&apos;t be charged again.
            </p>
            <div className="cn-actions">
              <button type="button" className="cn-btn" onClick={() => void refresh()}>
                Check again
              </button>
            </div>
            {helpLink}
          </>
        ) : null}

        {view === 'help' ? (
          <>
            <button type="button" className="cn-back" onClick={() => void refresh()}>
              <Icon d="M19 12H6M11 6.5 5.5 12 11 17.5" />
              Back
            </button>
            <Heading refEl={heading}>Help and recovery</Heading>
            <ul className="cn-faq">
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
                <strong>This page looks broken?</strong> Copy this page&apos;s address and open it
                in your normal browser.
              </li>
            </ul>
            {property ? (
              <>
                <p className="cn-office">
                  Property office:{' '}
                  {property.supportPhone ? (
                    <a href={`tel:${property.supportPhone}`}>{property.supportPhone}</a>
                  ) : (
                    'ask at reception'
                  )}
                </p>
                <h2 className="cn-sub">Send a message</h2>
                <SupportForm propertySlug={property.slug} signedIn={false} />
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
