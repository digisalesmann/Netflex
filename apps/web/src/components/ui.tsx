import type { ReactNode } from 'react';

export function Notice({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'ok' | 'warn' | 'bad';
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`notice notice--${tone}`} role={tone === 'bad' ? 'alert' : 'status'}>
      {title ? (
        <p>
          <strong>{title}</strong>
        </p>
      ) : null}
      {children}
    </div>
  );
}

export function Status({
  tone,
  children,
}: {
  tone: 'ok' | 'warn' | 'bad' | 'info';
  children: ReactNode;
}) {
  return <span className={`status status--${tone}`}>{children}</span>;
}

export function PageHead({
  eyebrow,
  title,
  lede,
}: {
  eyebrow?: string;
  title: string;
  lede?: ReactNode;
}) {
  return (
    <div className="page-head">
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h1>{title}</h1>
      {lede ? <p className="lede">{lede}</p> : null}
    </div>
  );
}

export function DraftPolicyNotice({ reviewed }: { reviewed: boolean }) {
  if (reviewed) return null;
  return (
    <Notice tone="warn" title="Draft pending legal review">
      <p>
        This policy has not yet been reviewed by the property&apos;s legal adviser and may change
        before paid service begins.
      </p>
    </Notice>
  );
}
