import Link from 'next/link';
import { STATE_LABEL, requireTenant, type Access } from '@/lib/account';
import { remaining, scopeLabel } from '@/lib/format';
import { serverApi } from '@/lib/server-api';

export const metadata = { title: 'My account' };

const ENDED = ['SUBSCRIPTION_EXPIRED', 'ACCESS_REVOKED'];

/** Share of the plan's time already used, 0–100, when it has started. */
function used(a: Access): number | null {
  if (!a.startsAt || !a.expiresAt || a.remainingSeconds === null) return null;
  const total = (Date.parse(a.expiresAt) - Date.parse(a.startsAt)) / 1000;
  if (total <= 0) return null;
  return Math.min(100, Math.max(0, 100 - (a.remainingSeconds / total) * 100));
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}

function PlanStatus({ a, lead }: { a: Access; lead: boolean }) {
  const s = STATE_LABEL[a.state] ?? { tone: 'info' as const, label: a.state };
  const pct = used(a);
  const role =
    a.role !== 'OWNER' ? ` · you are ${a.role === 'MANAGER' ? 'the manager' : 'a member'}` : '';
  return (
    <article className="acct-plan" data-lead={lead}>
      <div className="acct-plan__head">
        <div>
          <p className={`acct-plan__state acct-plan__state--${s.tone}`}>
            <span aria-hidden="true" />
            {s.label}
          </p>
          <h2 className="acct-plan__name">
            <Link href={`/account/access/${a.entitlementId}`}>{a.planName}</Link>
          </h2>
          <p className="acct-plan__for">
            {scopeLabel[a.scope]}
            {role}
          </p>
        </div>
        <p className="acct-plan__time">
          <strong>{remaining(a.remainingSeconds)}</strong>
          <span>
            {a.expiresAtLocal
              ? `Ends ${a.expiresAtLocal}`
              : a.activateBy
                ? `Use by ${a.activateBy}`
                : ''}
          </span>
        </p>
      </div>
      {pct !== null ? (
        <div
          className="acct-plan__meter"
          role="img"
          aria-label={`${Math.round(pct)}% of the plan's time used`}
        >
          <span style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      <dl className="acct-plan__facts">
        <div>
          <dt>Devices</dt>
          <dd>
            <span className="acct-dots" aria-hidden="true">
              {Array.from({ length: Math.min(a.devices.limit, 8) }, (_, i) => (
                <i key={i} data-on={i < a.devices.inUse} />
              ))}
            </span>
            {a.devices.inUse} of {a.devices.limit} in use
          </dd>
        </div>
        <div>
          <dt>Usage</dt>
          <dd className="muted">Not available yet</dd>
        </div>
      </dl>
      <div className="acct-plan__actions">
        <Link href={`/account/access/${a.entitlementId}`} className="acct-btn acct-btn--solid">
          Manage plan
          <span className="visually-hidden">: {a.planName}</span>
        </Link>
        <Link href="/account/plans" className="acct-btn">
          Buy another plan
        </Link>
      </div>
    </article>
  );
}

export default async function Overview() {
  const me = await requireTenant('/account');
  const access = (await serverApi<Access[]>('/me/access', { auth: true })).data ?? [];
  const live = access.filter((a) => !ENDED.includes(a.state));
  const past = access.filter((a) => ENDED.includes(a.state));
  const home = me.residence[0];
  const name = me.user.displayName && me.user.displayName !== 'Guest' ? me.user.displayName : '';
  return (
    <>
      <header className="acct-hello">
        <h1 className="acct-hello__title">Hello{name ? `, ${name}` : ''}</h1>
        <p className="acct-hello__where">
          <Icon d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />
          {home
            ? `${home.property.name} · Room ${home.room.label} (${home.room.floor.label})`
            : 'Not registered to a room. Room and floor plans need the property office to register you.'}
        </p>
      </header>

      <section className="acct-section" aria-labelledby="access-title">
        <h2 id="access-title" className="acct-label">
          Your access
        </h2>
        {live.length === 0 ? (
          <div className="acct-empty">
            <p className="acct-empty__title">You have no active plan.</p>
            <p className="acct-empty__body">
              Choose a plan here, or enter a voucher on the Wi-Fi sign-in page.
            </p>
            <div className="acct-plan__actions">
              <Link href="/account/plans" className="acct-btn acct-btn--solid">
                Choose a plan
              </Link>
              <Link href="/connect" className="acct-btn">
                Enter a voucher
              </Link>
            </div>
          </div>
        ) : (
          <div className="acct-plans">
            {live.map((a, i) => (
              <PlanStatus key={a.entitlementId} a={a} lead={i === 0} />
            ))}
          </div>
        )}
      </section>

      {past.length ? (
        <section className="acct-section">
          <details className="mk-faq__item acct-past">
            <summary>
              <span>Ended in the last 30 days ({past.length})</span>
              <span className="mk-faq__sign" aria-hidden="true" />
            </summary>
            <ul className="acct-past__list">
              {past.map((a) => (
                <li key={a.entitlementId}>
                  <span>{a.planName}</span>
                  <span className="muted">{STATE_LABEL[a.state]?.label ?? a.state}</span>
                </li>
              ))}
            </ul>
          </details>
        </section>
      ) : null}
    </>
  );
}
