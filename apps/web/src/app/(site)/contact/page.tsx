import { HelpDesk } from '@/components/help/HelpDesk';
import { Reveal } from '@/components/home/Reveal';
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
  const phone = property?.supportPhone ?? null;
  const email = property?.supportEmail ?? null;
  return (
    <>
      <section className="page-hero container">
        <Reveal>
          <p className="mk-eyebrow">Help</p>
          <h1 className="page-hero__title">Contact and support</h1>
          <p className="mk-lede">
            Tell us what&apos;s going on. We&apos;ll show you the quickest fix, and the lodge team
            is a message away if you still need them.
          </p>
        </Reveal>
      </section>

      <section className="mk-section help-desk" aria-label="Get help">
        <div className="container">
          <HelpDesk propertySlug={site.propertySlug} signedIn={signedIn} />
        </div>
      </section>

      {phone || email ? (
        <section className="talk" aria-labelledby="talk-title">
          <div className="container talk__inner">
            <div>
              <h2 id="talk-title" className="talk__title">
                Prefer to talk?
              </h2>
              <p className="talk__lede">
                Call or email the lodge team. Paid but not connected? Have your order reference
                ready (it starts with NFX-), and never pay twice for the same plan.
              </p>
            </div>
            <div className="talk__actions">
              {phone ? (
                <a href={`tel:${phone}`} className="talk__btn talk__btn--solid">
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M6.6 3.5h2.6l1.4 4-2 1.4a12 12 0 0 0 6.5 6.5l1.4-2 4 1.4v2.6a2 2 0 0 1-2.2 2A16.6 16.6 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z" />
                  </svg>
                  <span className="visually-hidden">Call </span>
                  {phone}
                </a>
              ) : null}
              {email ? (
                <a href={`mailto:${email}`} className="talk__btn talk__btn--glass">
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M3.5 6h17v12h-17zM3.5 6.5l8.5 7 8.5-7" />
                  </svg>
                  <span className="visually-hidden">Email </span>
                  {email}
                </a>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
