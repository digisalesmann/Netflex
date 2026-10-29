import { BuyPlan } from '@/components/account/BuyPlan';
import { Notice } from '@/components/ui';
import { requireTenant } from '@/lib/account';
import { scopeLabel } from '@/lib/format';
import { serverApi } from '@/lib/server-api';
import { site } from '@/lib/site';
import type { PublicPlan } from '@/lib/types';

export const metadata = { title: 'Plans' };

type Params = Promise<Record<string, string | string[] | undefined>>;

export default async function AccountPlans({ searchParams }: { searchParams: Params }) {
  const q = await searchParams;
  const me = await requireTenant('/account/plans');
  const renew = typeof q.renew === 'string' ? q.renew : undefined;
  const renewPlan = typeof q.plan === 'string' ? q.plan : undefined;
  const slug = me.residence[0]?.property.slug ?? site.propertySlug;
  const plans = (await serverApi<PublicPlan[]>(`/catalog/properties/${slug}/plans`)).data;
  const home = me.residence.find((r) => r.property.slug === slug);
  const can = (p: PublicPlan) => {
    if (p.scope === 'INDIVIDUAL')
      return { target: { scope: 'INDIVIDUAL' as const }, label: 'for me' };
    if (!home)
      return {
        target: null,
        label: 'Register with the property office to buy room or floor plans.',
      };
    if (p.scope === 'ROOM') {
      const ok = me.purchaseAuthority.some((a) => a.scope === 'ROOM' && a.roomId === home.room.id);
      return ok
        ? {
            target: { scope: 'ROOM' as const, roomId: home.room.id },
            label: `for room ${home.room.label}`,
          }
        : {
            target: null,
            label: `Only residents authorised by the property office can buy for room ${home.room.label}.`,
          };
    }
    const ok = me.purchaseAuthority.some(
      (a) => a.scope === 'FLOOR' && a.floorId === home.room.floor.id,
    );
    return ok
      ? {
          target: { scope: 'FLOOR' as const, floorId: home.room.floor.id },
          label: `for floor ${home.room.floor.label}`,
        }
      : {
          target: null,
          label: `Only residents authorised by the property office can buy for floor ${home.room.floor.label}.`,
        };
  };
  const shown = plans?.filter((p) => !renewPlan || p.planId === renewPlan) ?? null;
  return (
    <>
      <h1>{renew ? 'Renew your plan' : 'Plans'}</h1>
      {renew && shown?.length === 0 ? (
        <Notice tone="warn">
          This plan is no longer on sale. Choose another plan instead of renewing.
        </Notice>
      ) : null}
      {shown === null ? (
        <Notice tone="warn">Plans could not be loaded.</Notice>
      ) : (
        <ul className="rows">
          {shown.map((p) => {
            const c = can(p);
            return (
              <li key={p.planVersionId}>
                <div className="row-head">
                  <strong>
                    {p.name} <span className="muted small">· {scopeLabel[p.scope]}</span>
                  </strong>
                  <span className="plan-price">{p.price.display}</span>
                </div>
                <p className="muted small">{p.description}</p>
                <BuyPlan
                  plan={p}
                  target={c.target}
                  targetLabel={c.label}
                  {...(renew ? { renewEntitlementId: renew } : {})}
                />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
