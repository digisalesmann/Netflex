import Link from 'next/link';
import { Notice, Status } from '@/components/ui';
import { STATE_LABEL, requireTenant, type Access } from '@/lib/account';
import { remaining, scopeLabel } from '@/lib/format';
import { serverApi } from '@/lib/server-api';

export const metadata = { title: 'My account' };

export default async function Overview() {
  const me = await requireTenant('/account');
  const access = (await serverApi<Access[]>('/me/access', { auth: true })).data ?? [];
  const live = access.filter((a) => !['SUBSCRIPTION_EXPIRED', 'ACCESS_REVOKED'].includes(a.state));
  const past = access.filter((a) => ['SUBSCRIPTION_EXPIRED', 'ACCESS_REVOKED'].includes(a.state));
  const home = me.residence[0];
  return (
    <>
      <h1>
        Hello
        {me.user.displayName && me.user.displayName !== 'Guest' ? `, ${me.user.displayName}` : ''}
      </h1>
      <p className="muted">
        {home
          ? `${home.property.name} · Room ${home.room.label} (${home.room.floor.label})`
          : 'Not registered to a room. Room and floor plans need the property office to register you.'}
      </p>

      <h2 className="h3" style={{ marginTop: 'var(--nf-space-6)' }}>
        Your access
      </h2>
      {live.length === 0 ? (
        <Notice>
          <p>
            You have no active plan. <Link href="/account/plans">Choose a plan</Link>, or enter a
            voucher on the Wi-Fi sign-in page.
          </p>
        </Notice>
      ) : (
        <ul className="rows">
          {live.map((a) => {
            const s = STATE_LABEL[a.state] ?? { tone: 'info' as const, label: a.state };
            return (
              <li key={a.entitlementId}>
                <div className="row-head">
                  <strong>
                    <Link href={`/account/access/${a.entitlementId}`}>{a.planName}</Link>
                  </strong>
                  <Status tone={s.tone}>{s.label}</Status>
                </div>
                <dl className="facts">
                  <dt>For</dt>
                  <dd>
                    {scopeLabel[a.scope]}
                    {a.role !== 'OWNER'
                      ? ` · you are ${a.role === 'MANAGER' ? 'the manager' : 'a member'}`
                      : ''}
                  </dd>
                  <dt>Time</dt>
                  <dd>
                    {remaining(a.remainingSeconds)}
                    {a.expiresAtLocal
                      ? ` · ends ${a.expiresAtLocal}`
                      : a.activateBy
                        ? ` · use by ${a.activateBy}`
                        : ''}
                  </dd>
                  <dt>Devices</dt>
                  <dd>
                    {a.devices.inUse} of {a.devices.limit} in use
                  </dd>
                  <dt>Usage</dt>
                  <dd className="muted">Not available yet</dd>
                </dl>
              </li>
            );
          })}
        </ul>
      )}

      {past.length ? (
        <details style={{ marginTop: 'var(--nf-space-6)' }}>
          <summary>Ended in the last 30 days ({past.length})</summary>
          <ul className="rows">
            {past.map((a) => (
              <li key={a.entitlementId}>
                {a.planName} · {STATE_LABEL[a.state]?.label ?? a.state}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
