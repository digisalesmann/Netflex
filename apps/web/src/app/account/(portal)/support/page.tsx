import { HelpDesk } from '@/components/help/HelpDesk';
import { requireTenant } from '@/lib/account';
import { serverApi } from '@/lib/server-api';
import { site } from '@/lib/site';

export const metadata = { title: 'Help' };

interface Ticket {
  id: string;
  category: string;
  subject: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

const CATEGORY: Record<string, string> = {
  CONNECTIVITY: 'Can’t connect or slow',
  OUTAGE: 'Outage',
  PAYMENT: 'Payment',
  VOUCHER: 'Voucher code',
  ACCOUNT: 'My account',
  OTHER: 'Something else',
};

/** Progress along Received → Being handled → Resolved. */
const STEPS = ['Received', 'Being handled', 'Resolved'] as const;
function stepOf(status: string): number {
  if (status === 'RESOLVED' || status === 'CLOSED') return 2;
  if (status === 'IN_PROGRESS' || status === 'WAITING_ON_CUSTOMER') return 1;
  return 0;
}
const NOTE: Record<string, string> = {
  OPEN: 'The lodge team has your request.',
  IN_PROGRESS: 'The lodge team is working on it.',
  WAITING_ON_CUSTOMER: 'The team needs a reply from you. Check your phone.',
  RESOLVED: 'Marked as resolved.',
  CLOSED: 'Closed.',
};

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Lagos',
  }).format(new Date(iso));

export default async function Support() {
  const me = await requireTenant('/account/support');
  const tickets = (await serverApi<Ticket[]>('/me/tickets', { auth: true })).data ?? [];
  const open = tickets.filter((t) => stepOf(t.status) < 2);
  const done = tickets.filter((t) => stepOf(t.status) === 2);
  return (
    <>
      <header className="acct-page-head">
        <h1 className="acct-hello__title">Help</h1>
        <p className="acct-hello__where">
          Tell us what&apos;s going on. We&apos;ll show you the quickest fix, and you can follow
          every request here.
        </p>
      </header>

      <HelpDesk propertySlug={me.residence[0]?.property.slug ?? site.propertySlug} signedIn />

      <section className="req" aria-labelledby="req-title">
        <h2 id="req-title" className="acct-label">
          Your requests <span className="tkt-group__n">{tickets.length}</span>
        </h2>
        {tickets.length === 0 ? (
          <p className="req__none">
            No requests yet. Anything you send above appears here so you can follow it.
          </p>
        ) : (
          <>
            <ul className="req__list">
              {open.map((t) => (
                <Request key={t.id} t={t} />
              ))}
            </ul>
            {done.length ? (
              <details className="mk-faq__item req__done">
                <summary>
                  <span>Resolved ({done.length})</span>
                  <span className="mk-faq__sign" aria-hidden="true" />
                </summary>
                <ul className="req__list">
                  {done.map((t) => (
                    <Request key={t.id} t={t} />
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        )}
      </section>
    </>
  );
}

function Request({ t }: { t: Ticket }) {
  const step = stepOf(t.status);
  const waiting = t.status === 'WAITING_ON_CUSTOMER';
  return (
    <li className="req__item" data-waiting={waiting}>
      <div className="req__head">
        <div>
          <p className="req__subject">{t.subject}</p>
          <p className="req__meta">
            {CATEGORY[t.category] ?? t.category} · sent {when(t.createdAt)}
          </p>
        </div>
        <p className="req__note">{NOTE[t.status] ?? t.status}</p>
      </div>
      <ol className="req__track" aria-label={`Status: ${STEPS[step]}`}>
        {STEPS.map((s, i) => (
          <li key={s} data-state={i < step ? 'done' : i === step ? 'now' : 'todo'}>
            <span className="req__dot" aria-hidden="true" />
            <span className="req__label">{s}</span>
          </li>
        ))}
      </ol>
    </li>
  );
}
