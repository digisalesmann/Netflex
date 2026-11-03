'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A button that asks before doing something (sign out, sign out everywhere…).
 * Uses a native <dialog>, so focus, Esc and screen readers work; "Cancel" gets
 * focus first so a stray Enter never confirms by accident.
 */
export function ConfirmButton({
  className,
  children,
  title,
  body,
  confirmLabel,
  busyLabel = 'Signing out…',
  onConfirm,
  disabled,
}: {
  className?: string;
  /** Content of the trigger button. */
  children: ReactNode;
  title: string;
  body?: string;
  confirmLabel: string;
  busyLabel?: string;
  /** Runs on confirm; the dialog shows the busy label until it settles. */
  onConfirm: () => Promise<unknown>;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      cancel.current?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  const id = `confirm-${title.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <>
      <button type="button" className={className} disabled={disabled} onClick={() => setOpen(true)}>
        {children}
      </button>
      <dialog
        ref={ref}
        className="confirm"
        aria-labelledby={`${id}-t`}
        aria-describedby={body ? `${id}-b` : undefined}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget && !busy) setOpen(false);
        }}
      >
        <div className="confirm__inner">
          <span className="confirm__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M14.5 4.5h4v15h-4M10 16.5 14.5 12 10 7.5M14.5 12H3.5" />
            </svg>
          </span>
          <h2 id={`${id}-t`} className="confirm__title">
            {title}
          </h2>
          {body ? (
            <p id={`${id}-b`} className="confirm__body">
              {body}
            </p>
          ) : null}
          <div className="confirm__actions">
            <button
              ref={cancel}
              type="button"
              className="confirm__btn"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="confirm__btn confirm__btn--go"
              disabled={busy}
              onClick={() => void confirm()}
            >
              {busy ? busyLabel : confirmLabel}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
