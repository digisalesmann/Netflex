import { PlanTerms } from '@/components/PlanTerms';
import { Notice, PageHead } from '@/components/ui';
import { scopeLabel } from '@/lib/format';
import { getPlans } from '@/lib/property';

export const metadata = { title: 'Plans and pricing', alternates: { canonical: '/plans' } };

export default async function Plans() {
  const plans = await getPlans();
  return (
    <div className="container">
      <PageHead
        eyebrow="Pricing"
        title="Plans and pricing"
        lede="Prices include everything you pay to us. Buy on the Wi-Fi sign-in page or from your account."
      />
      {plans === null ? (
        <Notice tone="warn" title="Plans are unavailable right now">
          <p>We couldn&apos;t load the plan list. Please try again in a moment.</p>
        </Notice>
      ) : plans.length === 0 ? (
        <Notice title="No plans on sale yet">
          <p>The property hasn&apos;t published any plans yet. Ask at the office.</p>
        </Notice>
      ) : (
        <ul className="rows">
          {plans.map((p) => (
            <li key={p.planVersionId}>
              <div className="row-head">
                <h2 className="h3" style={{ margin: 0 }}>
                  {p.name} <span className="muted small">· {scopeLabel[p.scope]}</span>
                </h2>
                <span className="plan-price">{p.price.display}</span>
              </div>
              <p className="muted">{p.description}</p>
              <PlanTerms plan={p} />
            </li>
          ))}
        </ul>
      )}
      <p className="small muted" style={{ marginTop: 'var(--nf-space-5)' }}>
        Internet access is delivered by satellite through the property&apos;s network. Speeds depend
        on demand, weather and coverage in your room, and are not guaranteed.
      </p>
    </div>
  );
}
