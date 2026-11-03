import { FaqBrowser } from '@/components/faq/FaqBrowser';
import { FinalCta } from '@/components/home/FinalCta';
import { Reveal } from '@/components/home/Reveal';
import { FAQ } from '@/lib/faq';
import { getProperty } from '@/lib/property';

export const metadata = { title: 'FAQ', alternates: { canonical: '/faq' } };

export default async function Faq() {
  const property = await getProperty();
  // Lets search engines show the answers directly (schema.org FAQPage).
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map(([q, a]) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
  return (
    <>
      <section className="page-hero container">
        <Reveal>
          <p className="mk-eyebrow">Help</p>
          <h1 className="page-hero__title">Frequently asked questions</h1>
          <p className="mk-lede">
            Quick answers about plans, payments, devices and the connection.
          </p>
        </Reveal>
      </section>

      <section className="mk-section faq-page" aria-label="Questions and answers">
        <div className="container">
          <FaqBrowser />
        </div>
      </section>

      <FinalCta property={property} />
      <script
        type="application/ld+json"
        // Static content from our own FAQ list.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
    </>
  );
}
