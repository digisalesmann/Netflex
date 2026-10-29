import { SupportForm } from '@/components/SupportForm';
import { PageHead } from '@/components/ui';
import { getProperty } from '@/lib/property';
import { serverApi } from '@/lib/server-api';
import { site } from '@/lib/site';

export const metadata = { title: 'Contact and support', alternates: { canonical: '/contact' } };

export default async function Contact() {
  const [property, me] = await Promise.all([
    getProperty(),
    serverApi<{ user: { kind: string } }>('/me', { auth: true }),
  ]);
  const signedIn = me.data?.user.kind === 'TENANT';
  return (
    <div className="container">
      <PageHead
        eyebrow="Help"
        title="Contact and support"
        lede="Report a problem, ask about a payment, or get a lost code reissued."
      />
      <div className="grid grid--2">
        <section aria-labelledby="direct">
          <h2 id="direct" className="h3">
            Reach the property
          </h2>
          <dl className="facts">
            <dt>Phone</dt>
            <dd>
              {property?.supportPhone ? (
                <a href={`tel:${property.supportPhone}`}>{property.supportPhone}</a>
              ) : (
                'Ask at the office'
              )}
            </dd>
            <dt>Email</dt>
            <dd>
              {property?.supportEmail ? (
                <a href={`mailto:${property.supportEmail}`}>{property.supportEmail}</a>
              ) : (
                '—'
              )}
            </dd>
          </dl>
          <p className="muted small">
            Paid but not connected? Keep your order reference (starts with NFX-) and include it.
            Never pay twice for the same plan.
          </p>
        </section>
        <section aria-labelledby="write">
          <h2 id="write" className="h3">
            Send a message
          </h2>
          <SupportForm propertySlug={site.propertySlug} signedIn={signedIn} />
        </section>
      </div>
    </div>
  );
}
