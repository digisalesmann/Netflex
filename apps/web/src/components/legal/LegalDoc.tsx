'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export type LegalSection = { id: string; title: string; body: ReactNode };
export type LegalPoint = { title: string; body: string };

const DOCS = [
  { href: '/legal/terms', label: 'Terms' },
  { href: '/legal/privacy', label: 'Privacy' },
  { href: '/legal/refunds', label: 'Refunds' },
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}

/** Shared layout for the policy pages: switcher, summary, sticky index, numbered sections. */
export function LegalDoc({
  title,
  lede,
  updated,
  reviewed,
  points,
  sections,
  contact,
}: {
  title: string;
  lede: string;
  updated: string;
  reviewed: boolean;
  points?: LegalPoint[];
  sections: LegalSection[];
  contact: { name: string; email?: string | null; phone?: string | null };
}) {
  const path = usePathname();
  const [active, setActive] = useState(sections[0]?.id ?? '');
  const rowRef = useRef<HTMLOListElement>(null);

  // highlight the section being read
  // (the last section whose heading has passed the top third of the screen)
  const ids = sections.map((s) => s.id).join(',');
  useEffect(() => {
    const els = ids
      .split(',')
      .map((id) => document.getElementById(`${id}-title`))
      .filter((el): el is HTMLElement => el !== null);
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = window.innerHeight * 0.35;
      let current = els[0]?.id;
      for (const el of els) if (el.getBoundingClientRect().top <= line) current = el.id;
      // at the very bottom, the last section is the one being read
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2)
        current = els[els.length - 1]?.id;
      if (current) setActive(current.replace(/-title$/, ''));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ids]);

  // on phones, keep the active chip visible in the scrolling row
  useEffect(() => {
    const row = rowRef.current;
    const chip = row?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!row || !chip || row.scrollWidth <= row.clientWidth) return;
    row.scrollTo({ left: chip.offsetLeft - row.offsetLeft - 16, behavior: 'smooth' });
  }, [active]);

  return (
    <div className="lg">
      <header className="lg-hero container">
        <nav className="lg-switch" aria-label="Policies">
          {DOCS.map((d) => (
            <Link
              key={d.href}
              href={d.href}
              className="lg-switch__link"
              aria-current={path === d.href ? 'page' : undefined}
            >
              {d.label}
            </Link>
          ))}
        </nav>
        <p className="mk-eyebrow">Legal</p>
        <h1 className="lg-hero__title">{title}</h1>
        <p className="mk-lede">{lede}</p>
        <p className="lg-meta">
          {updated ? (
            <>
              <span>Last updated {updated}</span>
              <span aria-hidden="true">·</span>
            </>
          ) : null}
          <span>{sections.length} sections</span>
        </p>
        {!reviewed ? (
          <div className="lg-draft" role="note">
            <span className="lg-draft__dot" aria-hidden="true" />
            <p>
              <strong>Draft pending legal review.</strong> This policy has not yet been reviewed by
              the property&apos;s legal adviser and may change before paid service begins.
            </p>
          </div>
        ) : null}
      </header>

      {points?.length ? (
        <section className="lg-short container" aria-labelledby="lg-short-title">
          <h2 id="lg-short-title" className="lg-short__title">
            In short
          </h2>
          <ul className="lg-short__grid">
            {points.map((p) => (
              <li key={p.title}>
                <strong>{p.title}</strong>
                <span>{p.body}</span>
              </li>
            ))}
          </ul>
          <p className="lg-short__note">
            A quick summary to help you read. The full text below is what applies.
          </p>
        </section>
      ) : null}

      <div className="lg-body container">
        <nav className="lg-index" aria-label="On this page">
          <p className="lg-index__label">On this page</p>
          <ol ref={rowRef}>
            {sections.map((s, i) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="lg-index__link"
                  aria-current={active === s.id ? 'true' : undefined}
                >
                  <span className="lg-index__num">{String(i + 1).padStart(2, '0')}</span>
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="lg-doc">
          {sections.map((s, i) => (
            <section key={s.id} id={s.id} className="lg-sec" aria-labelledby={`${s.id}-title`}>
              <span className="lg-sec__num" aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </span>
              <div className="lg-sec__text">
                <h2 id={`${s.id}-title`}>{s.title}</h2>
                {s.body}
              </div>
            </section>
          ))}

          <footer className="lg-ask">
            <h2 className="lg-ask__title">Questions about this policy?</h2>
            <p>Contact {contact.name}. We&apos;re happy to explain anything here.</p>
            <div className="lg-ask__links">
              {contact.email ? (
                <a href={`mailto:${contact.email}`}>
                  <Icon d="M3.5 6h17v12h-17zM4 6.5l8 6.5 8-6.5" />
                  {contact.email}
                </a>
              ) : null}
              {contact.phone ? (
                <a href={`tel:${contact.phone.replace(/\s+/g, '')}`}>
                  <Icon d="M5 4h3.5l1.5 4-2 1.5a10.5 10.5 0 0 0 6.5 6.5l1.5-2 4 1.5V19a1.5 1.5 0 0 1-1.5 1.5A15.5 15.5 0 0 1 3.5 5.5 1.5 1.5 0 0 1 5 4z" />
                  {contact.phone}
                </a>
              ) : null}
              <Link href="/contact">
                <Icon d="M4 5.5h16v10H9l-5 4z" />
                Help page
              </Link>
            </div>
          </footer>
        </article>
      </div>
    </div>
  );
}
