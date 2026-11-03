import Link from 'next/link';
import { Reveal } from './Reveal';

/** Photo: supplied by the owner (media/photos/lady.jpeg). */
function Photo() {
  return (
    <figure className="mk-photo mk-photo--lady">
      <img
        src="/media/photos/lady.jpeg"
        alt="A woman at her desk speaking into her phone while working on a laptop."
        width={736}
        height={1104}
        loading="lazy"
        decoding="async"
      />
    </figure>
  );
}

const POINTS = [
  {
    title: 'Add residents by phone',
    body: 'The plan’s manager adds roommates with their phone number, up to the plan’s limit.',
    icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20c1.2-3.2 4-5 7.5-5M18 14v6M15 17h6',
  },
  {
    title: 'Everyone on their own devices',
    body: 'Each resident signs in their own phone or laptop. The shared device count is always visible.',
    icon: 'M7 3.5h7a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5zM9.5 17h2M18.5 8v8',
  },
  {
    title: 'Stay in control',
    body: 'Remove a resident or a device at any time, hand the manager role to someone else, or leave a plan yourself.',
    icon: 'M12 3.5 19 6v5.5c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6zM9 12l2.2 2.2L15.5 10',
  },
];

export function SharedLiving() {
  return (
    <section className="mk-section mk-shared" aria-labelledby="shared-title">
      <div className="container mk-split mk-split--media">
        <div>
          <Reveal className="mk-head">
            <p className="mk-eyebrow">Room and floor plans</p>
            <h2 id="shared-title" className="mk-title">
              One plan for the whole room.
            </h2>
            <p className="mk-lede">
              Share a single plan with the people you live with. Everyone connects on their own
              devices, and one person keeps it organised.
            </p>
          </Reveal>
          <ul className="mk-points">
            {POINTS.map((p, i) => (
              <Reveal as="li" key={p.title} delay={i * 90}>
                <span className="mk-points__icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path d={p.icon} />
                  </svg>
                </span>
                <span>
                  <strong className="mk-points__title">{p.title}</strong>
                  <span className="mk-points__body">{p.body}</span>
                </span>
              </Reveal>
            ))}
          </ul>
          <Reveal className="mk-split__foot">
            <Link href="/plans" className="mk-link">
              See room and floor plans
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M5 12h13M13 6.5 18.5 12 13 17.5" />
              </svg>
            </Link>
            <p className="small muted">
              Room and floor plans are bought by residents authorised for that room or floor.
            </p>
          </Reveal>
        </div>
        <Reveal className="mk-media" delay={120}>
          <Photo />
        </Reveal>
      </div>
    </section>
  );
}
