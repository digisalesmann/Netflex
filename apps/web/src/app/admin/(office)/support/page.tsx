import Link from 'next/link';
import { redirect } from 'next/navigation';
import { TicketActions } from '@/components/admin/SupportActions';
import { adminApi, allowed, currentProperty, requireStaff } from '@/lib/admin';
import { when } from '@/lib/admin-payments';

export const metadata = { title: 'Support' };

type Params = Promise<Record<string, string | string[] | undefined>>;

interface Ticket {
  id: string;
  category: string;
  subject: string;
  body: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'WAITING_ON_CUSTOMER' | 'RESOLVED' | 'CLOSED';
  contactPhone: string | null;
  createdAt: string;
  updatedAt: string;
  requester: {
    id: string;
    displayName: string;
    email: string | null;
    phoneE164: string | null;
  } | null;
  assignedTo: { id: string; displayName: string } | null;
}

const CATEGORY: Record<string, string> = {
  CONNECTIVITY: 'Can’t connect or slow',
  OUTAGE: 'Outage',
  PAYMENT: 'Payment',
  VOUCHER: 'Voucher code',
  ACCOUNT: 'Account',
  PRIVACY: 'Privacy',
  OTHER: 'Something else',
};
const STATUS: Record<Ticket['status'], { label: string; tone: string }> = {
  OPEN: { label: 'New', tone: 'warn' },
  IN_PROGRESS: { label: 'Being handled', tone: 'info' },
  WAITING_ON_CUSTOMER: { label: 'Waiting on resident', tone: 'muted' },
  RESOLVED: { label: 'Resolved', tone: 'ok' },
  CLOSED: { label: 'Closed', tone: 'muted' },
};

export default async function SupportPage({ searchParams }: { searchParams: Params }) {
  const me = await requireStaff('/admin/support');
  const { property } = await currentProperty();
  if (!property || !allowed(me, 'support.manage', property.id)) redirect('/admin');
  const q = await searchParams;
  const show = q.show === 'done' ? 'done' : 'open';
  const all = (await adminApi<Ticket[]>(property.id, '/tickets')).data ?? [];
  const isOpen = (t: Ticket) => t.status !== 'RESOLVED' && t.status !== 'CLOSED';
  const open = all.filter(isOpen);
  const done = all.filter((t) => !isOpen(t));
  // New first, then being handled, then waiting.
  const rank = { OPEN: 0, IN_PROGRESS: 1, WAITING_ON_CUSTOMER: 2, RESOLVED: 3, CLOSED: 4 };
  const rows = (show === 'open' ? open : done).sort(
    (a, b) => rank[a.status] - rank[b.status] || b.createdAt.localeCompare(a.createdAt),
  );

  return (
    <>
      <header className="adm-head">
        <p className="adm-head__eyebrow">{property.name}</p>
        <h1 className="adm-head__title">Support</h1>
        <p className="adm-head__lede">
          Messages from residents and guests. Reply by phone or email, then mark where it stands:
          they see the status in their account.
        </p>
      </header>

      <nav className="adm-tabs adm-subnav" aria-label="Which requests">
        <Link href="/admin/support" aria-current={show === 'open' ? 'page' : undefined}>
          To do {open.length ? <span>{open.length}</span> : null}
        </Link>
        <Link href="/admin/support?show=done" aria-current={show === 'done' ? 'page' : undefined}>
          Done
        </Link>
      </nav>

      {rows.length ? (
        <ul className="adm-tickets">
          {rows.map((t) => {
            const st = STATUS[t.status];
            const phone = t.contactPhone ?? t.requester?.phoneE164 ?? null;
            const email = t.requester?.email ?? null;
            const who =
              t.requester?.displayName && t.requester.displayName !== 'Guest'
                ? t.requester.displayName
                : (email ?? phone ?? 'Guest');
            return (
              <li key={t.id} className="adm-ticket">
                <span className="adm-ticket__top">
                  <span className="adm-tag" data-tone={st.tone}>
                    {st.label}
                  </span>
                  <span className="adm-ticket__cat">{CATEGORY[t.category] ?? t.category}</span>
                  <span className="adm-ticket__when">{when(t.createdAt)}</span>
                </span>
                <strong className="adm-ticket__subject">{t.subject}</strong>
                <p className="adm-ticket__body">{t.body}</p>
                <span className="adm-ticket__who">
                  From {who}
                  {t.assignedTo
                    ? ` · ${t.assignedTo.id === me.user.id ? 'you’re handling it' : `${t.assignedTo.displayName} is handling it`}`
                    : ''}
                </span>
                <span className="adm-ticket__reply">
                  {phone ? (
                    <a className="adm-btn adm-btn--quiet" href={`tel:${phone}`}>
                      Call {phone}
                    </a>
                  ) : null}
                  {email ? (
                    <a
                      className="adm-btn adm-btn--quiet"
                      href={`mailto:${email}?subject=${encodeURIComponent(`Re: ${t.subject}`)}`}
                    >
                      Email
                    </a>
                  ) : null}
                  <TicketActions
                    propertyId={property.id}
                    ticketId={t.id}
                    status={t.status}
                    mine={t.assignedTo?.id === me.user.id}
                    taken={t.assignedTo !== null}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="adm-clear">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M5 12.5 10 17.5 19 7" />
          </svg>
          {show === 'open' ? 'Nothing to do. All caught up.' : 'Nothing resolved yet.'}
        </p>
      )}
    </>
  );
}
