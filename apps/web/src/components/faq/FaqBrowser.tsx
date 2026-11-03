'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { FAQ_TOPICS, faqId } from '@/lib/faq';

/**
 * FAQ grouped by topic, with instant search and topic filters. Without
 * JavaScript every question is still listed and expandable (native details).
 */
export function FaqBrowser() {
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState<string>('all');

  // A link like /faq#do-i-need-an-account opens that answer and brings it into view.
  useEffect(() => {
    const openFromHash = () => {
      const el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (el instanceof HTMLDetailsElement) {
        el.open = true;
        el.scrollIntoView({ block: 'center' });
        el.querySelector('summary')?.focus({ preventScroll: true });
      }
    };
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    return () => window.removeEventListener('hashchange', openFromHash);
  }, []);

  const q = query.trim().toLowerCase();
  const topics = useMemo(
    () =>
      FAQ_TOPICS.filter((t) => topic === 'all' || t.id === topic)
        .map((t) => ({
          ...t,
          items: q
            ? t.items.filter(([question, answer]) =>
                `${question} ${answer}`.toLowerCase().includes(q),
              )
            : t.items,
        }))
        .filter((t) => t.items.length),
    [q, topic],
  );
  const count = topics.reduce((n, t) => n + t.items.length, 0);

  return (
    <div className="faqb">
      <div className="faqb__controls">
        <label className="faqb__search">
          <span className="visually-hidden">Search questions</span>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M11 18.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM20.5 20.5 16.3 16.3" />
          </svg>
          <input
            type="search"
            placeholder="Search questions"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
        </label>
        <div className="chips faqb__chips" role="group" aria-label="Topic">
          <button
            type="button"
            className="chip"
            aria-pressed={topic === 'all'}
            onClick={() => setTopic('all')}
          >
            All topics
          </button>
          {FAQ_TOPICS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="chip"
              aria-pressed={topic === t.id}
              onClick={() => setTopic(t.id)}
            >
              <span className="lbl-long">{t.label}</span>
              <span className="lbl-short" aria-hidden="true">
                {t.short}
              </span>
            </button>
          ))}
        </div>
      </div>

      <p className="visually-hidden" aria-live="polite">
        {count} question{count === 1 ? '' : 's'} shown
      </p>

      {topics.length ? (
        topics.map((t) => (
          <section key={t.id} className="faqb__group" aria-labelledby={`topic-${t.id}`}>
            <h2 id={`topic-${t.id}`} className="faqb__topic">
              {t.label}
            </h2>
            <div className="mk-faq__list faqb__list">
              {t.items.map(([question, answer]) => (
                <details
                  key={question}
                  id={faqId(question)}
                  className="mk-faq__item"
                  open={q.length > 1}
                >
                  <summary>
                    <span>{question}</span>
                    <span className="mk-faq__sign" aria-hidden="true" />
                  </summary>
                  <p>{answer}</p>
                </details>
              ))}
            </div>
          </section>
        ))
      ) : (
        <div className="faqb__empty">
          <p className="faqb__empty-title">No questions match “{query}”.</p>
          <p>
            Try another word, or{' '}
            <Link href="/contact" className="faqb__empty-link">
              ask the lodge team
            </Link>
            .
          </p>
        </div>
      )}
    </div>
  );
}
