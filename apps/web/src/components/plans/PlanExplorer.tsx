'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { PlanCards } from '@/components/home/PlansShowcase';
import { activation, duration, scopeLabel, speed } from '@/lib/format';
import {
  AUDIENCES,
  LENGTHS,
  lengthOf,
  sortPlans,
  type AudienceId,
  type LengthId,
} from '@/lib/plans';
import type { PublicPlan } from '@/lib/types';

/** The same pre-purchase terms customers see before paying (spec §10), as table rows. */
const ROWS: [string, (p: PublicPlan) => string][] = [
  ['Price', (p) => p.price.display],
  ['Lasts', (p) => duration(p.duration)],
  ['Starts', (p) => activation(p)],
  [
    'For',
    (p) =>
      `${scopeLabel[p.scope]}${p.maxGroupMembers ? ` (up to ${p.maxGroupMembers} people)` : ''}`,
  ],
  [
    'Devices',
    (p) =>
      `Up to ${p.maxDevices} device${p.maxDevices === 1 ? '' : 's'}, ${p.maxConcurrentSessions} online at once`,
  ],
  ['Speed', (p) => speed(p.speed)],
  ['Fair use', (p) => p.fairUseText ?? '—'],
  ['Refunds', (p) => p.refundPolicyText],
];

type Selection = { audience: AudienceId; length: LengthId | 'all' };

/**
 * Plans by audience (for you / room / floor), then by length (hourly to monthly).
 * Only options that have plans are offered. The selection lives in the URL, so a
 * view can be shared (e.g. /plans?for=room&length=monthly).
 */
export function PlanExplorer({
  plans,
  initial,
}: {
  plans: PublicPlan[];
  initial: { for?: string; length?: string };
}) {
  const router = useRouter();
  const path = usePathname();
  const sorted = useMemo(() => sortPlans(plans), [plans]);
  const audiences = AUDIENCES.filter((a) => sorted.some((p) => p.scope === a.scope));

  const [sel, setSel] = useState<Selection>(() => {
    const audience = audiences.find((a) => a.id === initial.for)?.id ?? audiences[0]?.id ?? 'you';
    const length = LENGTHS.some((l) => l.id === initial.length)
      ? (initial.length as LengthId)
      : 'all';
    return { audience, length };
  });

  const audience = audiences.find((a) => a.id === sel.audience) ?? audiences[0];
  const inAudience = sorted.filter((p) => p.scope === audience?.scope);
  const lengths = LENGTHS.filter((l) => inAudience.some((p) => lengthOf(p) === l.id));
  const length = lengths.some((l) => l.id === sel.length) ? sel.length : 'all';
  const shown = length === 'all' ? inAudience : inAudience.filter((p) => lengthOf(p) === length);

  const choose = (next: Selection) => {
    setSel(next);
    const q = new URLSearchParams();
    if (next.audience !== audiences[0]?.id) q.set('for', next.audience);
    if (next.length !== 'all') q.set('length', next.length);
    router.replace(q.size ? `${path}?${q}` : path, { scroll: false });
  };

  if (!audience) return null;
  return (
    <>
      <div className="explorer__controls">
        {audiences.length > 1 ? (
          <div className="segmented" role="group" aria-label="Who the plan is for">
            {audiences.map((a) => (
              <button
                key={a.id}
                type="button"
                className="segmented__btn"
                aria-pressed={a.id === audience.id}
                onClick={() => choose({ audience: a.id, length: 'all' })}
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
        ) : null}
        <p className="explorer__blurb">{audience.blurb}</p>
        {lengths.length > 1 ? (
          <div
            className="chips"
            role="group"
            aria-label="Plan length"
            data-count={lengths.length + 1}
          >
            <button
              type="button"
              className="chip"
              aria-pressed={length === 'all'}
              onClick={() => choose({ audience: audience.id, length: 'all' })}
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
                onClick={() => choose({ audience: audience.id, length: l.id })}
              >
                {l.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <h2 className="visually-hidden" aria-live="polite">
        {shown.length} {audience.label.toLowerCase()} plan{shown.length === 1 ? '' : 's'}
        {length !== 'all' ? `, ${length}` : ''}
      </h2>
      <PlanCards key={`${audience.id}-${length}`} plans={shown} headingLevel="h3" showTerms />

      <section className="explorer__compare" aria-labelledby="compare-title">
        <div className="mk-head mk-head--center">
          <p className="mk-eyebrow">Compare</p>
          <h2 id="compare-title" className="mk-title">
            Every detail, side by side.
          </h2>
          <p className="mk-lede">
            The same terms you see before you pay, for the {shown.length} plan
            {shown.length === 1 ? '' : 's'} shown above.
          </p>
        </div>
        <div className="compare" role="region" aria-labelledby="compare-title" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th scope="col">
                  <span className="visually-hidden">Detail</span>
                </th>
                {shown.map((p) => (
                  <th key={p.planVersionId} scope="col">
                    {p.name}
                    <span className="compare__scope">{scopeLabel[p.scope]}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([label, value]) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  {shown.map((p) => (
                    <td key={p.planVersionId}>{value(p)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
