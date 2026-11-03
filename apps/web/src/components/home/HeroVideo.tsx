'use client';

import { useEffect, useRef, useState } from 'react';

type Props = {
  /** Shown immediately (and instead of the video when motion or data should be saved). */
  poster: string;
  /** ~720p rendition for small screens; ~1080p for large ones. */
  srcSmall: string;
  srcLarge: string;
};

/** Seconds of crossfade between the end of one loop and the start of the next. */
const FADE = 1.4;

type NetworkInformation = { saveData?: boolean; effectiveType?: string };

/** Data saver on, a very slow connection, or reduced motion: keep the still image. */
function shouldSkipVideo(): boolean {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
  const c = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  return Boolean(c?.saveData || (c?.effectiveType && /(^|-)2g$/.test(c.effectiveType)));
}

/**
 * Full-bleed background video for the home hero. Two stacked <video> elements
 * crossfade at the loop point so the timelapse never visibly jumps. The poster
 * stays until the first frame is actually playing. A pause control is always
 * offered (WCAG 2.2.2), and playback stops while the hero is off screen.
 */
export function HeroVideo({ poster, srcSmall, srcLarge }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [front, setFront] = useState(0);
  const a = useRef<HTMLVideoElement>(null);
  const b = useRef<HTMLVideoElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  const visibleRef = useRef(true);
  const frontRef = useRef(0);
  const fading = useRef(false);

  // Pick a rendition after mount (never on the server: keeps the first paint light).
  useEffect(() => {
    if (shouldSkipVideo()) return;
    setSrc(window.matchMedia('(min-width: 900px)').matches ? srcLarge : srcSmall);
  }, [srcLarge, srcSmall]);

  useEffect(() => {
    if (!src) return;
    const va = a.current;
    const vb = b.current;
    if (!va || !vb) return;
    const vids = [va, vb] as const;
    for (const v of vids) {
      v.muted = true;
      v.defaultMuted = true;
      v.playsInline = true;
    }
    const current = () => (frontRef.current === 0 ? va : vb);
    const shouldPlay = () => !pausedRef.current && visibleRef.current && !document.hidden;

    const sync = () => {
      const v = current();
      if (shouldPlay()) void v.play().catch(() => undefined);
      else v.pause();
    };

    const onPlaying = () => setPlaying(true);
    const onTime = (e: Event) => {
      const v = e.target as HTMLVideoElement;
      if (v !== current() || fading.current || !v.duration) return;
      if (v.duration - v.currentTime > FADE) return;
      // Start the other copy from the top and crossfade to it.
      fading.current = true;
      const next = 1 - frontRef.current;
      const n = next === 0 ? va : vb;
      n.currentTime = 0;
      void n.play().catch(() => undefined);
      frontRef.current = next;
      setFront(next);
      window.setTimeout(() => {
        v.pause();
        fading.current = false;
      }, FADE * 1000);
    };

    for (const v of vids) {
      v.addEventListener('playing', onPlaying);
      v.addEventListener('timeupdate', onTime);
    }
    const io = new IntersectionObserver(([entry]) => {
      visibleRef.current = Boolean(entry?.isIntersecting);
      sync();
    });
    if (wrap.current) io.observe(wrap.current);
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', sync);
      for (const v of vids) {
        v.removeEventListener('playing', onPlaying);
        v.removeEventListener('timeupdate', onTime);
        v.pause();
      }
    };
  }, [src]);

  const toggle = () => {
    const next = !pausedRef.current;
    pausedRef.current = next;
    setPaused(next);
    const v = [a.current, b.current][frontRef.current];
    if (!v) return;
    if (next) v.pause();
    else void v.play().catch(() => undefined);
  };

  return (
    <div className="hero__media" ref={wrap} data-playing={playing}>
      <img className="hero__poster" src={poster} alt="" fetchPriority="high" decoding="async" />
      {src ? (
        <>
          <video
            ref={a}
            className="hero__video"
            data-front={front === 0}
            src={src}
            preload="auto"
            aria-hidden="true"
            tabIndex={-1}
          />
          <video
            ref={b}
            className="hero__video"
            data-front={front === 1}
            src={src}
            preload="auto"
            aria-hidden="true"
            tabIndex={-1}
          />
          <button
            type="button"
            className="hero__pause"
            onClick={toggle}
            aria-label={paused ? 'Play background video' : 'Pause background video'}
          >
            {paused ? (
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M8 5.5v13M16 5.5v13" stroke="currentColor" strokeWidth="2.4" />
              </svg>
            )}
          </button>
        </>
      ) : null}
    </div>
  );
}
