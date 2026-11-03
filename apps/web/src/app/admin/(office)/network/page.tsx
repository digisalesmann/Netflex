import { redirect } from 'next/navigation';
import {
  CheckGateway,
  CheckNetwork,
  GatewaySwitch,
  RetryJob,
} from '@/components/admin/NetworkActions';
import { adminApi, allowed, currentProperty, requireStaff } from '@/lib/admin';
import { when } from '@/lib/admin-payments';

export const metadata = { title: 'Network' };

interface Gateway {
  id: string;
  name: string;
  vendor: 'MIKROTIK' | 'UNIFI' | 'OTHER' | 'FAKE';
  model: string | null;
  firmware: string | null;
  status: 'UNVERIFIED' | 'HEALTHY' | 'DEGRADED' | 'UNREACHABLE' | 'DISABLED';
  lastHealthAt: string | null;
  lastHealthyAt: string | null;
}
interface Session {
  id: string;
  ipAddress: string | null;
  macAddress: string;
  startedAt: string;
  lastSeenAt: string | null;
}
interface Job {
  id: string;
  type: 'ACTIVATE' | 'APPLY_POLICY' | 'SUSPEND' | 'REVOKE' | 'DISCONNECT' | 'RECONCILE';
  status: 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'RETRY_SCHEDULED' | 'FAILED' | 'CANCELLED';
  attempts: number;
  lastErrorCode: string | null;
  createdAt: string;
}

const GW_STATUS: Record<Gateway['status'], { label: string; tone: string }> = {
  HEALTHY: { label: 'Working', tone: 'ok' },
  DEGRADED: { label: 'Having trouble', tone: 'warn' },
  UNREACHABLE: { label: 'Not answering', tone: 'bad' },
  UNVERIFIED: { label: 'Not checked yet', tone: 'info' },
  DISABLED: { label: 'Turned off', tone: 'muted' },
};
const VENDOR = { MIKROTIK: 'MikroTik', UNIFI: 'UniFi', OTHER: 'Other', FAKE: 'Simulated (test)' };
const JOB: Record<Job['type'], string> = {
  ACTIVATE: 'Switch a plan on',
  APPLY_POLICY: 'Update a plan’s limits',
  SUSPEND: 'Pause a plan',
  REVOKE: 'Cut a plan off',
  DISCONNECT: 'Disconnect a device',
  RECONCILE: 'Network check',
};
const JOB_STATUS: Record<Job['status'], { label: string; tone: string }> = {
  PENDING: { label: 'Waiting', tone: 'info' },
  IN_PROGRESS: { label: 'Working', tone: 'info' },
  SUCCEEDED: { label: 'Done', tone: 'ok' },
  RETRY_SCHEDULED: { label: 'Will retry', tone: 'warn' },
  FAILED: { label: 'Failed', tone: 'bad' },
  CANCELLED: { label: 'Cancelled', tone: 'muted' },
};

export default async function NetworkPage() {
  const me = await requireStaff('/admin/network');
  const { property } = await currentProperty();
  if (!property || !allowed(me, 'network.read', property.id)) redirect('/admin');
  const canOperate = allowed(me, 'network.operate', property.id);
  const [gw, ss, jobs] = await Promise.all([
    adminApi<Gateway[]>(property.id, '/gateways'),
    adminApi<Session[]>(property.id, '/network/sessions'),
    adminApi<Job[]>(property.id, '/network/operations?limit=30'),
  ]);
  const gateways = gw.data ?? [];
  const sessions = ss.data ?? [];
  const ops = jobs.data ?? [];
  const failed = ops.filter((j) => j.status === 'FAILED').length;

  return (
    <>
      <header className="adm-head adm-head--row">
        <div>
          <p className="adm-head__eyebrow">{property.name}</p>
          <h1 className="adm-head__title">Network</h1>
          <p className="adm-head__lede">
            The Wi-Fi equipment, who&apos;s online, and the instructions the system sends it.
          </p>
        </div>
        {canOperate && gateways.length ? <CheckNetwork propertyId={property.id} /> : null}
      </header>

      {!gateways.length ? (
        <p className="adm-callout" role="note">
          <strong>No Wi-Fi equipment connected yet.</strong> Paid sign-in goes live after the
          on-site setup: the Omada controller on the office laptop, then a test with a real phone.
          Until then, plans can be sold but nobody is switched on automatically.
        </p>
      ) : null}

      <section className="adm-section" aria-labelledby="gw-title">
        <h2 id="gw-title" className="adm-h2">
          Equipment
        </h2>
        {gateways.length ? (
          <ul className="adm-list">
            {gateways.map((g) => {
              const st = GW_STATUS[g.status];
              return (
                <li key={g.id} className="adm-gw">
                  <span className="adm-list__main">
                    <strong className="adm-plain">{g.name}</strong>
                    <span>
                      {VENDOR[g.vendor]}
                      {g.model ? ` ${g.model}` : ''}
                      {g.firmware ? ` · firmware ${g.firmware}` : ''}
                    </span>
                    <span>
                      {g.lastHealthAt ? `Last checked ${when(g.lastHealthAt)}` : 'Never checked'}
                      {g.lastHealthyAt && g.status !== 'HEALTHY'
                        ? ` · last working ${when(g.lastHealthyAt)}`
                        : ''}
                    </span>
                  </span>
                  <span className="adm-gw__side">
                    <span className="adm-tag" data-tone={st.tone}>
                      {st.label}
                    </span>
                    {canOperate ? (
                      <span className="adm-gw__actions">
                        {g.status !== 'DISABLED' ? (
                          <CheckGateway propertyId={property.id} gatewayId={g.id} />
                        ) : null}
                        <GatewaySwitch
                          propertyId={property.id}
                          gatewayId={g.id}
                          disabled={g.status === 'DISABLED'}
                        />
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="adm-empty">None yet.</p>
        )}
      </section>

      <div className="adm-grid adm-section">
        <section aria-labelledby="on-title">
          <h2 id="on-title" className="adm-h2">
            Online now <span className="adm-count">{sessions.length}</span>
          </h2>
          {sessions.length ? (
            <ul className="adm-list">
              {sessions.slice(0, 50).map((s) => (
                <li key={s.id}>
                  <span className="adm-list__main">
                    <strong>Device …{s.macAddress.slice(-5)}</strong>
                    <span>
                      {s.ipAddress ?? 'no address yet'} · since {when(s.startedAt)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="adm-empty">Nobody online right now.</p>
          )}
        </section>

        <section aria-labelledby="jobs-title">
          <h2 id="jobs-title" className="adm-h2">
            Recent instructions{' '}
            {failed ? <span className="adm-count adm-count--bad">{failed} failed</span> : null}
          </h2>
          {ops.length ? (
            <ul className="adm-list">
              {ops.map((j) => {
                const st = JOB_STATUS[j.status];
                return (
                  <li key={j.id}>
                    <span className="adm-list__main">
                      <strong className="adm-plain">{JOB[j.type]}</strong>
                      <span>
                        {when(j.createdAt)}
                        {j.attempts > 1 ? ` · ${j.attempts} tries` : ''}
                        {j.lastErrorCode && j.status !== 'SUCCEEDED'
                          ? ` · ${j.lastErrorCode.toLowerCase().replace(/_/g, ' ')}`
                          : ''}
                      </span>
                    </span>
                    <span className="adm-list__side">
                      <span className="adm-tag" data-tone={st.tone}>
                        {st.label}
                      </span>
                      {j.status === 'FAILED' && canOperate ? (
                        <RetryJob propertyId={property.id} operationId={j.id} />
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="adm-empty">No instructions sent yet.</p>
          )}
        </section>
      </div>
    </>
  );
}
