import Link from 'next/link';
import { Reveal } from './Reveal';

const FACTS = [
  {
    title: 'Low-orbit satellites',
    body: 'The satellites orbit far closer to Earth than older satellite internet, which keeps the connection responsive.',
    icon: 'M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM4.5 16.5c-2-3-.3-7.6 3.8-10.2 4.1-2.6 9-2.4 11 .7 2 3 .3 7.6-3.8 10.2-4.1 2.6-9 2.4-11-.7z',
  },
  {
    title: 'Shared across the lodge',
    body: 'Wi-Fi access points carry the connection around the property. The signal is strongest near them.',
    icon: 'M12 18.5h.01M8.5 15a5 5 0 0 1 7 0M5.5 12a9.2 9.2 0 0 1 13 0M2.5 9a13.4 13.4 0 0 1 19 0',
  },
  {
    title: 'Honest about speed',
    body: 'Speed depends on how many people are online, the weather and where you are in the building. It’s never promised.',
    icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5v5M12 16h.01',
  },
];

/** Photo: NASA, ISS Expedition 73 (iss073e0982679), public domain. */
export function Connectivity() {
  return (
    <section className="mk-orbit" aria-labelledby="orbit-title">
      <div className="container">
        <Reveal className="mk-head mk-head--center">
          <p className="mk-eyebrow">The connection</p>
          <h2 id="orbit-title" className="mk-title">
            Internet from orbit, brought to your room.
          </h2>
          <p className="mk-lede">
            Netflex runs on a low-earth-orbit satellite network. The lodge&apos;s Wi-Fi shares it
            around the property for everyday browsing, messaging and calls.
          </p>
        </Reveal>
      </div>
      <figure className="mk-orbit__photo">
        <img
          src="/media/photos/earth-orbit-1920.webp"
          srcSet="/media/photos/earth-orbit-960.webp 960w, /media/photos/earth-orbit-1920.webp 1920w"
          sizes="100vw"
          alt="The Milky Way above Earth's glowing horizon at night, with city lights below, seen from the International Space Station."
          width={1920}
          height={1280}
          loading="lazy"
          decoding="async"
        />
      </figure>
      <div className="container">
        <ul className="mk-features mk-orbit__facts">
          {FACTS.map((f, i) => (
            <Reveal as="li" key={f.title} delay={i * 80}>
              <span className="mk-points__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d={f.icon} />
                </svg>
              </span>
              <strong className="mk-points__title">{f.title}</strong>
              <span className="mk-points__body">{f.body}</span>
            </Reveal>
          ))}
        </ul>
        <Reveal className="mk-account__cta">
          <Link href="/coverage" className="mk-link">
            Check coverage at the lodge
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M5 12h13M13 6.5 18.5 12 13 17.5" />
            </svg>
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
