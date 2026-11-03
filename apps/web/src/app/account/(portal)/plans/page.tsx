import { PlanShop, type Eligibility } from '@/components/account/PlanShop';
import { Notice } from '@/components/ui';
import { eligibilityFor, requireTenant } from '@/lib/account';
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
  const can = (p: PublicPlan) => eligibilityFor(me, slug, p);
  const shown = plans?.filter((p) => !renewPlan || p.planId === renewPlan) ?? null;
  const eligibility: Eligibility = Object.fromEntries(
    (shown ?? []).map((p) => [p.planVersionId, can(p)]),
  );
  const shared = (shown ?? []).filter((p) => p.scope !== 'INDIVIDUAL');
  const notice = !shared.length
    ? null
    : !home
      ? 'Register with the property office to buy room or floor plans.'
      : shared.some((p) => !eligibility[p.planVersionId]?.target)
        ? 'Some room and floor plans need authorisation from the property office.'
        : null;
  return (
    <>
      <header className="acct-page-head">
        <h1 className="acct-hello__title">{renew ? 'Renew your plan' : 'Plans'}</h1>
        <p className="acct-hello__where">
          {renew
            ? 'Renewing adds time after your current plan ends.'
            : 'Choose a plan, check every term, then pay securely with Paystack.'}
        </p>
      </header>
      {renew && shown?.length === 0 ? (
        <Notice tone="warn">
          This plan is no longer on sale. Choose another plan instead of renewing.
        </Notice>
      ) : null}
      {shown === null ? (
        <Notice tone="warn">Plans could not be loaded.</Notice>
      ) : shown.length ? (
        <PlanShop
          plans={shown}
          eligibility={eligibility}
          notice={notice}
          {...(renew ? { renewEntitlementId: renew } : {})}
        />
      ) : null}
    </>
  );
}
