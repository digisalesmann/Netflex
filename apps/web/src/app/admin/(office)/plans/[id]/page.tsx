import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { EditPlan, PlanStatus, PublishVersion } from '@/components/admin/PlanActions';
import { PlanTerms } from '@/components/PlanTerms';
import { adminApi, allowed, currentProperty, requireStaff } from '@/lib/admin';
import { shortDate } from '@/lib/admin-data';
import {
  PLAN_STATUS,
  SCOPE_LABEL,
  versionsOf,
  type PlanDetail,
  type PlanVersion,
} from '@/lib/admin-plans';
import { duration } from '@/lib/format';

export const metadata = { title: 'Plan' };

function Receipt({ v, label }: { v: PlanVersion; label: string }) {
  return (
    <div className="receipt adm-receipt">
      <div className="receipt__paper">
        <p className="adm-receipt__label">{label}</p>
        <div className="receipt__item">
          <div>
            <p className="receipt__name">{v.name}</p>
            <p className="receipt__meta">
              {SCOPE_LABEL[v.scope]} · {duration(v.duration)}
            </p>
          </div>
          <p className="receipt__amt">{v.price.display}</p>
        </div>
        <hr className="receipt__tear" />
        <PlanTerms plan={v} />
      </div>
    </div>
  );
}

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireStaff(`/admin/plans/${id}`);
  const { property } = await currentProperty();
  if (!property || !allowed(me, 'plan.read', property.id)) redirect('/admin');
  const p = (await adminApi<PlanDetail>(property.id, `/plans/${id}`)).data;
  if (!p) notFound();
  const canManage = allowed(me, 'plan.manage', property.id) && p.status !== 'ARCHIVED';
  const { live, draft, shown } = versionsOf(p);
  if (!shown) notFound();
  const st = PLAN_STATUS[p.status];

  return (
    <>
      <Link href="/admin/plans" className="adm-back">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M19 12H6M11 6.5 5.5 12 11 17.5" />
        </svg>
        Plans
      </Link>
      <header className="adm-head adm-head--row">
        <div>
          <p className="adm-head__eyebrow">
            <span className="adm-tag" data-tone={st.tone}>
              {st.label}
            </span>
          </p>
          <h1 className="adm-head__title">{shown.name}</h1>
          <p className="adm-head__lede">{shown.description}</p>
        </div>
        {canManage ? (
          <div className="adm-actions">
            <EditPlan propertyId={property.id} planId={p.id} plan={draft ?? shown} />
            {p.status === 'PUBLISHED' ? (
              <PlanStatus propertyId={property.id} planId={p.id} action="pause" />
            ) : null}
            {p.status === 'PAUSED' ? (
              <PlanStatus propertyId={property.id} planId={p.id} action="resume" />
            ) : null}
            <PlanStatus propertyId={property.id} planId={p.id} action="archive" />
          </div>
        ) : null}
      </header>

      <div className="adm-grid">
        <section aria-labelledby="terms-title">
          <h2 id="terms-title" className="adm-h2">
            {live ? 'What buyers get now' : 'Saved terms'}
          </h2>
          <Receipt
            v={live ?? shown}
            label={
              live?.publishedAt
                ? `Version ${live.version} · on sale since ${shortDate(live.publishedAt)}`
                : `Version ${shown.version} · not on sale yet`
            }
          />
          {draft && live ? (
            <div className="adm-waiting">
              <h2 className="adm-h2">Waiting to go on sale</h2>
              <Receipt v={draft} label={`Version ${draft.version} · saved, not on sale`} />
              {canManage ? (
                <PublishVersion
                  propertyId={property.id}
                  planId={p.id}
                  versionId={draft.planVersionId}
                  version={draft.version}
                />
              ) : null}
            </div>
          ) : !live && canManage ? (
            <div className="adm-after">
              <PublishVersion
                propertyId={property.id}
                planId={p.id}
                versionId={shown.planVersionId}
                version={shown.version}
              />
            </div>
          ) : null}
        </section>

        <section aria-labelledby="hist-title">
          <h2 id="hist-title" className="adm-h2">
            Versions
          </h2>
          <p className="adm-sub">
            Each change is a new version. Buyers always keep the terms they paid for.
          </p>
          <ol className="adm-timeline">
            {p.versions.map((v) => (
              <li key={v.planVersionId} data-current={v === live}>
                <strong>
                  Version {v.version} · {v.price.display.replace(/\.00$/, '')}
                </strong>
                <span>
                  {v.publishedAt
                    ? `On sale from ${shortDate(v.publishedAt)}${v === live ? ' (current)' : ''}`
                    : 'Saved, never on sale'}
                  {v.locked ? ' · bought by residents' : ''}
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </>
  );
}
