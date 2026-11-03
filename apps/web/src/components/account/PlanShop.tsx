'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { duration } from '@/lib/format';
import {
  AUDIENCES,
  LENGTHS,
  lengthOf,
  lowestDaily,
  money,
  perDay,
  sortPlans,
  type AudienceId,
  type LengthId,
} from '@/lib/plans';
import type { PublicPlan } from '@/lib/types';

import type { Eligible } from '@/lib/account';

export type Eligibility = Record<string, Eligible>;

/** Account plan shop: filter by audience and length; each plan opens its checkout page. */
export function PlanShop({
  plans,
  eligibility,
  renewEntitlementId,
  notice,
}: {
  plans: PublicPlan[];
  eligibility: Eligibility;
  renewEntitlementId?: string;
  /** Shown when shared plans exist but can't be bought (e.g. not registered to a room). */
  notice: string | null;
}) {
  const sorted = useMemo(() => sortPlans(plans), [plans]);
  const audiences = AUDIENCES.filter((a) => sorted.some((p) => p.scope === a.scope));
  const [audienceId, setAudienceId] = useState<AudienceId>(audiences[0]?.id ?? 'you');
  const [length, setLength] = useState<LengthId | 'all'>('all');

  const audience = audiences.find((a) => a.id === audienceId) ?? audiences[0];
  const inAudience = sorted.filter((p) => p.scope === audience?.scope);
  const lengths = LENGTHS.filter((l) => inAudience.some((p) => lengthOf(p) === l.id));
  const shown = length === 'all' ? inAudience : inAudience.filter((p) => lengthOf(p) === length);
  const best = lowestDaily(shown);
  const verb = renewEntitlementId ? 'Renew' : 'Buy';

  return (
    <div className="shop">
      {audiences.length > 1 ? (
        <div className="shop__controls">
          <div className="segmented" role="group" aria-label="Who the plan is for">
            {audiences.map((a) => (
              <button
                key={a.id}
                type="button"
                className="segmented__btn"
                aria-pressed={a.id === audience?.id}
                onClick={() => {
                  setAudienceId(a.id);
                  setLength('all');
                }}
              >
                <span className="lbl-long">{a.label}</span>
                <span className="lbl-short" aria-hidden="true">
                  {a.short}
                </span>
                <span className="segmented__count">
                  {sorted.filter((p) => p.scope === a.scope).length}
                </span>
              </button>
            ))}
          </div>
          {lengths.length > 1 ? (
            <div className="chips" role="group" aria-label="Plan length">
              <button
                type="button"
                className="chip"
                aria-pressed={length === 'all'}
                onClick={() => setLength('all')}
              >
                <span className="lbl-long">All lengths</span>
                <span className="lbl-short" aria-hidden="true">
                  All
                </span>
              </button>
              {lengths.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className="chip"
                  aria-pressed={length === l.id}
                  onClick={() => setLength(l.id)}
                >
                  {l.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {notice ? (
        <p className="shop__notice">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01" />
          </svg>
          {notice}
        </p>
      ) : null}

      <ul className="shop__grid">
        {shown.map((p) => {
          const e = eligibility[p.planVersionId];
          const daily = perDay(p);
          const isBest = p.planVersionId === best;
          return (
            <li key={p.planVersionId}>
              <article
                className="apc"
                data-best={isBest}
                aria-labelledby={`apc-${p.planVersionId}`}
              >
                <div className="apc__paper">
                  <div className="apc__top">
                    <span className="apc__scope">{audience?.label}</span>
                    {isBest ? <span className="apc__badge">Lowest daily price</span> : null}
                  </div>
                  <h2 id={`apc-${p.planVersionId}`} className="apc__name">
                    {p.name}
                  </h2>
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
                  </dl>
                  <hr className="apc__tear" />
                  <p className="apc__price">
                    <span className="apc__total">Total</span>
                    <strong>{money(BigInt(p.price.amountMinor), p.price.currency)}</strong>
                  </p>
                  <p className="apc__daily" data-empty={!daily}>
                    {daily ? `≈ ${money(daily, p.price.currency)} a day` : '\u00a0'}
                  </p>
                  {e?.target ? (
                    <Link
                      href={`/account/checkout?plan=${p.planVersionId}${
                        renewEntitlementId ? `&renew=${renewEntitlementId}` : ''
                      }`}
                      className="apc__buy"
                    >
                      {verb} {p.name}
                    </Link>
                  ) : (
                    <p className="apc__locked">
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M6.5 10.5V8a5.5 5.5 0 0 1 11 0v2.5M5 10.5h14v10H5z" />
                      </svg>
                      {e?.label ?? 'Not available to buy here.'}
                    </p>
                  )}
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
