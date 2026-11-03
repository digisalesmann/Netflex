'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '@/lib/api';

/**
 * Office UI kit: a slide-in panel for forms (native <dialog>, so focus, Esc and
 * screen readers work) and a form wrapper that runs one API call, shows the
 * server's message on failure, and refreshes the page data on success.
 */

export function Panel({
  label,
  title,
  lede,
  tone = 'solid',
  children,
}: {
  /** Text of the button that opens the panel. */
  label: string;
  title: string;
  lede?: string;
  tone?: 'solid' | 'quiet' | 'danger';
  children: (close: () => void) => ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const close = () => setOpen(false);
  return (
    <>
      <button type="button" className={`adm-btn adm-btn--${tone}`} onClick={() => setOpen(true)}>
        {label}
      </button>
      <dialog
        ref={ref}
        className="adm-panel"
        aria-labelledby={`${title}-t`}
        onClose={close}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        {open ? (
          <div className="adm-panel__inner">
            <header className="adm-panel__head">
              <h2 id={`${title}-t`}>{title}</h2>
              <button type="button" className="adm-panel__x" onClick={close}>
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
                <span className="adm-sr">Close</span>
              </button>
            </header>
            {lede ? <p className="adm-panel__lede">{lede}</p> : null}
            {children(close)}
          </div>
        ) : null}
      </dialog>
    </>
  );
}

export function ActionForm({
  submit,
  done,
  cta,
  busyCta = 'Saving…',
  tone = 'solid',
  children,
}: {
  /** Runs the API call with the form's values. */
  submit: (f: FormData) => Promise<unknown>;
  /** Called after success (e.g. close the panel). The page data refreshes automatically. */
  done?: (result: unknown) => void;
  cta: string;
  busyCta?: string;
  tone?: 'solid' | 'danger';
  children: ReactNode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await submit(new FormData(e.currentTarget));
      router.refresh();
      done?.(r);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="adm-form" onSubmit={(e) => void onSubmit(e)} noValidate>
      {error ? (
        <p className="adm-form__error" role="alert">
          {error}
        </p>
      ) : null}
      {children}
      <button className={`adm-btn adm-btn--${tone} adm-form__submit`} type="submit" disabled={busy}>
        {busy ? busyCta : cta}
      </button>
    </form>
  );
}

/** The server's message plus any field problems, in plain words. */
export function errorText(err: unknown): string {
  if (!(err instanceof ApiError))
    return err instanceof Error && err.message
      ? err.message
      : 'Something went wrong. Please try again.';
  const fields = err.details?.fields;
  if (Array.isArray(fields) && fields.length) {
    const names = fields
      .map((f) => (typeof f === 'object' && f && 'path' in f ? String(f.path) : ''))
      .filter(Boolean);
    if (names.length) return `${err.message} Check: ${[...new Set(names)].join(', ')}.`;
  }
  return err.message;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="adm-field">
      <span className="adm-field__label">{label}</span>
      {hint ? <span className="adm-field__hint">{hint}</span> : null}
      {children}
    </label>
  );
}

/** Today in Lagos as YYYY-MM-DD, for date inputs. */
export function todayLagos(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());
}

/**
 * A date input value (YYYY-MM-DD, Lagos) as an ISO instant: "today" means right
 * now (so same-day moves and move-outs are in order); other days mean midnight.
 */
export function lagosDayStart(value: string): string {
  if (value === todayLagos()) return new Date().toISOString();
  return new Date(`${value}T00:00:00+01:00`).toISOString();
}
