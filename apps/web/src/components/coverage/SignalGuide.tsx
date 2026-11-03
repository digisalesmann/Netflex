'use client';

import { useEffect, useRef, useState } from 'react';

const STATES = [
  { id: 'go', img: '/media/photos/signal-go.webp', alt: 'Traffic light showing green: Go.' },
  { id: 'wait', img: '/media/photos/signal-wait.webp', alt: 'Traffic light showing amber: Wait.' },
  { id: 'stop', img: '/media/photos/signal-stop.webp', alt: 'Traffic light showing red: Stop.' },
] as const;

const STEP_MS = 2600;
/** Stop after a few rounds so the motion doesn't run forever (WCAG 2.2.2). */
const MAX_STEPS = STATES.length * 4;

/**
 * Go → Wait → Stop on the plain page background, with a soft glow that takes
 * the colour of the light. Runs only while on screen; tap to pause or resume.
 * Reduced motion: shows "Go" and stays still.
 */
export function SignalGuide() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  const steps = useRef(0);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(Boolean(e?.isIntersecting)));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (paused || !visible) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = window.setInterval(() => {
      steps.current += 1;
      if (steps.current >= MAX_STEPS) {
        setActive(0);
        setPaused(true);
        return;
      }
      setActive((i) => (i + 1) % STATES.length);
    }, STEP_MS);
    return () => window.clearInterval(t);
  }, [paused, visible]);

  const toggle = () => {
    if (paused) steps.current = 0;
    setPaused((p) => !p);
  };

  const current = STATES[active] ?? STATES[0];
  return (
    <div className="sguide" ref={wrap} data-state={current.id} data-paused={paused}>
      <span className="sguide__glow" aria-hidden="true" />
      <div className="sguide__stage" role="img" aria-label={current.alt} onClick={toggle}>
        {STATES.map((s, i) => (
          <img
            key={s.id}
            className="sguide__img"
            src={s.img}
            alt=""
            data-on={i === active}
            width={560}
            height={727}
            decoding="async"
          />
        ))}
      </div>
      <button type="button" className="sguide__pause" onClick={toggle}>
        {paused ? 'Play animation' : 'Pause animation'}
      </button>
    </div>
  );
}
