'use client';

import { useEffect, useState } from 'react';

/** Copies a value and confirms with a tick for a moment. `label` names it for screen readers. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      className="adm-qr__copy"
      data-copied={copied}
      onClick={() =>
        void navigator.clipboard
          .writeText(value)
          .then(() => setCopied(true))
          .catch(() => null)
      }
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d={
            copied
              ? 'M5 12.5 10 17.5 19 7'
              : 'M8.5 8.5V5.5A1.5 1.5 0 0 1 10 4h8.5A1.5 1.5 0 0 1 20 5.5V14a1.5 1.5 0 0 1-1.5 1.5h-3M5.5 8.5H14A1.5 1.5 0 0 1 15.5 10v8.5A1.5 1.5 0 0 1 14 20H5.5A1.5 1.5 0 0 1 4 18.5V10a1.5 1.5 0 0 1 1.5-1.5z'
          }
        />
      </svg>
      <span className="adm-sr">{copied ? `${label} copied` : `Copy ${label}`}</span>
      <span className="adm-sr" aria-live="polite">
        {copied ? 'Copied' : ''}
      </span>
    </button>
  );
}
