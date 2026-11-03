'use client';

export function PrintButton() {
  return (
    <button type="button" className="acct-btn no-print" onClick={() => window.print()}>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M7 8.5V3.5h10v5M7 17.5H4.5v-9h15v9H17M7 14.5h10v6H7z" />
      </svg>
      Print or save as PDF
    </button>
  );
}
