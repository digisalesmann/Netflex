import Link from 'next/link';
import { PlanTerms } from '@/components/PlanTerms';
import { duration } from '@/lib/format';
import { featured, lowestDaily, money, perDay } from '@/lib/plans';
import type { PublicPlan } from '@/lib/types';
import { Reveal } from './Reveal';

const SCOPE_LINE = { INDIVIDUAL: 'Just you', ROOM: 'Whole room', FLOOR: 'Whole floor' } as const;

/**
 * Plan cards as thermal-paper receipts (same look as checkout), shared by the
 * home page and the Plans page. `showTerms` adds every pre-purchase term in an
 * expandable section.
 */
export function PlanCards({
  plans,
  headingLevel = 'h3',
  showTerms = false,
}: {
  plans: PublicPlan[];
  headingLevel?: 'h2' | 'h3';
  showTerms?: boolean;
}) {
  const Heading = headingLevel;
  const highlight = lowestDaily(plans);
  return (
    <ul className="pcards" data-count={plans.length}>
      {plans.map((p, i) => {
        const best = p.planVersionId === highlight;
        const daily = perDay(p);
        const kbps = p.speed.downloadKbps;
        return (
          <Reveal as="li" key={p.planVersionId} delay={(i % 3) * 100} className="pcard-wrap">
            <article className="apc" data-best={best} aria-labelledby={`plan-${p.slug}`}>
              <div className="apc__paper">
                <div className="apc__top">
                  <span className="apc__scope">{SCOPE_LINE[p.scope]}</span>
                  {best ? <span className="apc__badge">Lowest daily price</span> : null}
                </div>
                <Heading id={`plan-${p.slug}`} className="apc__name">
                  {p.name}
                </Heading>
                <dl className="apc__lines">
                  <div>
                    <dt>Lasts</dt>
                    <dd>{duration(p.duration)}</dd>
                  </div>
                  <div>
                    <dt>Devices</dt>
                    <dd>{p.maxDevices}</dd>
                  </div>
                  {p.maxGroupMembers ? (
                    <div>
                      <dt>People</dt>
                      <dd>up to {p.maxGroupMembers}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Speed cap</dt>
                    <dd>{kbps === null ? 'None' : `${Math.round(kbps / 100) / 10} Mbps`}</dd>
                  </div>
                </dl>
                <hr className="apc__tear" />
                <p className="apc__price">
                  <span className="apc__total">Total</span>
                  <strong>{money(BigInt(p.price.amountMinor), p.price.currency)}</strong>
                </p>
                <p className="apc__daily" data-empty={!daily}>
                  {daily ? `≈ ${money(daily, p.price.currency)} a day` : '\u00a0'}
                </p>
                {showTerms ? (
                  <details className="receipt__terms apc__terms">
                    <summary>
                      <span>Everything included</span>
                      <span className="mk-faq__sign" aria-hidden="true" />
                    </summary>
                    <PlanTerms plan={p} />
                  </details>
                ) : null}
                <Link href="/account/plans" className="apc__buy">
                  {p.scope === 'INDIVIDUAL' ? 'Get this plan' : 'Get it from your account'}
                  <span className="visually-hidden">: {p.name}</span>
                </Link>
              </div>
            </article>
          </Reveal>
        );
      })}
    </ul>
  );
}

export function PlansShowcase({ plans }: { plans: PublicPlan[] | null }) {
  if (!plans?.length) return null;
  return (
    <section className="mk-section mk-plans" aria-labelledby="plans-title">
      <div className="container">
        <Reveal className="mk-head">
          <p className="mk-eyebrow">Plans</p>
          <h2 id="plans-title" className="mk-title">
            Pay for the time you need.
          </h2>
          <p className="mk-lede">
            Simple, time-based plans. The price, devices and terms are all shown before you pay,
            with no sign-up fee.
          </p>
        </Reveal>
        <PlanCards plans={featured(plans)} />
        <Reveal className="pcards__foot">
          <p className="small muted">
            Also on sale on the Wi-Fi sign-in page. Room plans are for authorised residents. Speeds
            vary with demand and conditions and are not guaranteed.
          </p>
          <Link href="/plans" className="mk-link">
            Compare all plans and terms
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M5 12h13M13 6.5 18.5 12 13 17.5" />
            </svg>
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
