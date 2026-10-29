import { SupportForm } from '@/components/SupportForm';
import { Notice, Status } from '@/components/ui';
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
}

export default async function Support() {
  const me = await requireTenant('/account/support');
  const tickets = (await serverApi<Ticket[]>('/me/tickets', { auth: true })).data ?? [];
  return (
    <div className="grid grid--2">
      <section aria-labelledby="new">
        <h1 id="new">Help</h1>
        <p className="muted">Report an outage, ask about a payment, or get a code reissued.</p>
        <SupportForm propertySlug={me.residence[0]?.property.slug ?? site.propertySlug} signedIn />
      </section>
      <section aria-labelledby="mine">
        <h2 id="mine" className="h3">
          Your requests
        </h2>
        {tickets.length === 0 ? (
          <Notice>No requests yet.</Notice>
        ) : (
          <ul className="rows">
            {tickets.map((t) => (
              <li key={t.id}>
                <div className="row-head">
                  <strong>{t.subject}</strong>
                  <Status tone={t.status === 'RESOLVED' || t.status === 'CLOSED' ? 'ok' : 'info'}>
                    {t.status.replaceAll('_', ' ').toLowerCase()}
                  </Status>
                </div>
                <span className="small muted">
                  {t.category.toLowerCase()} ·{' '}
                  {new Date(t.createdAt).toLocaleDateString('en-NG', { dateStyle: 'medium' })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
