import Link from 'next/link';
import { redirect } from 'next/navigation';
import { NewPlan } from '@/components/admin/PlanActions';
import { adminApi, allowed, currentProperty, requireStaff } from '@/lib/admin';
import { duration } from '@/lib/format';
import { PLAN_STATUS, SCOPE_LABEL, versionsOf, type PlanDetail } from '@/lib/admin-plans';

export const metadata = { title: 'Plans' };

export default async function PlansPage() {
  const me = await requireStaff('/admin/plans');
  const { property } = await currentProperty();
  if (!property || !allowed(me, 'plan.read', property.id)) redirect('/admin');
  const canManage = allowed(me, 'plan.manage', property.id);

  const list = (await adminApi<{ id: string }[]>(property.id, '/plans')).data ?? [];
  const plans = (
    await Promise.all(list.map((p) => adminApi<PlanDetail>(property.id, `/plans/${p.id}`)))
  )
    .map((r) => r.data)
    .filter((p): p is PlanDetail => p !== null);
  const order = { PUBLISHED: 0, PAUSED: 1, DRAFT: 2, ARCHIVED: 3 };
  plans.sort((a, b) => order[a.status] - order[b.status]);
  const onSale = plans.filter((p) => p.status === 'PUBLISHED').length;

  return (
    <>
      <header className="adm-head adm-head--row">
        <div>
          <p className="adm-head__eyebrow">{property.name}</p>
          <h1 className="adm-head__title">Plans</h1>
          <p className="adm-head__lede">
            {onSale} on sale · {plans.length} in total
          </p>
        </div>
        {canManage ? <NewPlan propertyId={property.id} /> : null}
      </header>

      {plans.length ? (
        <ul className="adm-plans">
          {plans.map((p) => {
            const { shown: live, draft } = versionsOf(p);
            const st = PLAN_STATUS[p.status];
            if (!live) return null;
            return (
              <li key={p.id}>
                <Link href={`/admin/plans/${p.id}`} className="adm-plan">
                  <span className="adm-plan__main">
                    <strong>{live.name}</strong>
                    <span>
                      {duration(live.duration)} · {live.maxDevices}{' '}
                      {live.maxDevices === 1 ? 'device' : 'devices'} · {SCOPE_LABEL[live.scope]}
                    </span>
                    {draft && draft !== live ? (
                      <span className="adm-plan__draft">
                        Version {draft.version} saved, not on sale yet
                      </span>
                    ) : null}
                  </span>
                  <span className="adm-plan__side">
                    <strong>{live.price.display.replace(/\.00$/, '')}</strong>
                    <span className="adm-tag" data-tone={st.tone}>
                      {st.label}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="adm-empty">No plans yet. Create the first one to start selling.</p>
      )}
    </>
  );
}
