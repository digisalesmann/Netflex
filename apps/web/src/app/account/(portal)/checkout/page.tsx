import Link from 'next/link';
import { CheckoutForm } from '@/components/account/CheckoutForm';
import { Logo } from '@/components/Logo';
import { PlanTerms } from '@/components/PlanTerms';
import { Notice } from '@/components/ui';
import { eligibilityFor, requireTenant } from '@/lib/account';
import { duration, scopeLabel } from '@/lib/format';
import { serverApi } from '@/lib/server-api';
import { site } from '@/lib/site';
import type { PublicPlan } from '@/lib/types';

export const metadata = { title: 'Checkout' };

type Params = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function Checkout({ searchParams }: { searchParams: Params }) {
  const q = await searchParams;
  const planId = one(q.plan);
  const renew = one(q.renew);
  const me = await requireTenant(`/account/checkout?plan=${planId ?? ''}`);
  const slug = me.residence[0]?.property.slug ?? site.propertySlug;
  const plans = (await serverApi<PublicPlan[]>(`/catalog/properties/${slug}/plans`)).data;
  const plan = plans?.find((p) => p.planVersionId === planId) ?? null;
  const back = renew ? `/account/plans?renew=${renew}` : '/account/plans';

  if (!plan) {
    return (
      <div className="co-missing">
        <h1 className="acct-hello__title">Checkout</h1>
        <Notice tone="warn" title="This plan isn’t available">
          <p>It may no longer be on sale. Choose another plan.</p>
        </Notice>
        <Link href="/account/plans" className="acct-btn acct-btn--solid">
          Back to plans
        </Link>
      </div>
    );
  }

  const e = eligibilityFor(me, slug, plan);
  const venue = me.residence[0]?.property.name ?? site.brand;
  const today = new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Lagos',
  }).format(new Date());
  return (
    <div className="co">
      <Link href={back} className="co-back">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M19 12H6M11 6.5 5.5 12 11 17.5" />
        </svg>
        Back to plans
      </Link>
      <h1 className="acct-hello__title co-title">{renew ? 'Renew' : 'Checkout'}</h1>

      <div className="co-grid">
        <div className="co-main">
          <section className="co-step" aria-labelledby="co-who">
            <span className="co-step__n" aria-hidden="true">
              1
            </span>
            <div className="co-step__body">
              <h2 id="co-who" className="co-step__title">
                Who it&apos;s for
              </h2>
              <p className="co-who">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20c1.2-3.3 4-5 7.5-5s6.3 1.7 7.5 5" />
                </svg>
                <span>
                  <strong>{e.target ? e.label : scopeLabel[plan.scope]}</strong>
                  <span>
                    {me.user.displayName} · {me.user.email ?? me.user.phoneE164}
                  </span>
                </span>
              </p>
              {renew ? (
                <p className="co-note">
                  Renewal: the new time is added after your current plan ends, so nothing is lost.
                </p>
              ) : null}
            </div>
          </section>

          {e.target ? (
            <CheckoutForm
              planVersionId={plan.planVersionId}
              priceDisplay={plan.price.display}
              target={e.target}
              {...(renew ? { renewEntitlementId: renew } : {})}
            />
          ) : (
            <Notice tone="warn" title="You can’t buy this plan yet">
              <p>{e.label}</p>
            </Notice>
          )}
        </div>

        <aside className="receipt" aria-labelledby="co-summary-title">
          <div className="receipt__paper">
            <div className="receipt__head">
              <Logo decorative />
              <p className="receipt__venue">{venue}</p>
              <p id="co-summary-title" className="receipt__title">
                Order summary
              </p>
              <p className="receipt__date">{today}</p>
            </div>
            <hr className="receipt__tear" />
            <div className="receipt__item">
              <div>
                <p className="receipt__name">{plan.name}</p>
                <p className="receipt__meta">
                  {scopeLabel[plan.scope]} · {duration(plan.duration)}
                </p>
              </div>
              <p className="receipt__amt">{plan.price.display}</p>
            </div>
            <dl className="receipt__lines">
              <div>
                <dt>Subtotal</dt>
                <dd>{plan.price.display}</dd>
              </div>
              <div>
                <dt>Fees</dt>
                <dd>₦0.00</dd>
              </div>
            </dl>
            <hr className="receipt__tear" />
            <dl className="receipt__lines receipt__lines--total">
              <div>
                <dt>Total</dt>
                <dd>{plan.price.display}</dd>
              </div>
            </dl>
            <hr className="receipt__tear" />
            <details className="receipt__terms">
              <summary>
                <span>Everything included</span>
                <span className="mk-faq__sign" aria-hidden="true" />
              </summary>
              <PlanTerms plan={plan} />
            </details>
            <p className="receipt__secure">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M6.5 10.5V8a5.5 5.5 0 0 1 11 0v2.5M5 10.5h14v10H5zM12 14.5v2.5" />
              </svg>
              Secured by Paystack. Your card details never reach us.
            </p>
            <div className="receipt__barcode" aria-hidden="true" />
            <p className="receipt__thanks">Thank you</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
