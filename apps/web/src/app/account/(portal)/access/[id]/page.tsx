import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AccessManager } from '@/components/account/AccessManager';
import { Status } from '@/components/ui';
import { STATE_LABEL, requireTenant, type Access } from '@/lib/account';
import { remaining, scopeLabel } from '@/lib/format';
import { serverApi } from '@/lib/server-api';

export const metadata = { title: 'Plan details' };

export default async function AccessDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireTenant(`/account/access/${id}`);
  const list = (await serverApi<Access[]>('/me/access', { auth: true })).data ?? [];
  const a = list.find((x) => x.entitlementId === id);
  if (!a) notFound();
  const s = STATE_LABEL[a.state] ?? { tone: 'info' as const, label: a.state };
  const canRenew =
    a.role !== 'MEMBER' &&
    a.expiresAt !== null &&
    !['SUBSCRIPTION_EXPIRED', 'ACCESS_REVOKED'].includes(a.state);
  return (
    <>
      <p>
        <Link href="/account">← Overview</Link>
      </p>
      <h1>{a.planName}</h1>
      <p>
        <Status tone={s.tone}>{s.label}</Status>
      </p>
      <dl className="facts">
        <dt>For</dt>
        <dd>{scopeLabel[a.scope]}</dd>
        <dt>Time</dt>
        <dd>{remaining(a.remainingSeconds)}</dd>
        {a.expiresAtLocal ? (
          <>
            <dt>Ends</dt>
            <dd>{a.expiresAtLocal}</dd>
          </>
        ) : null}
        {a.activateBy ? (
          <>
            <dt>Use by</dt>
            <dd>{a.activateBy}</dd>
          </>
        ) : null}
        <dt>Voucher</dt>
        <dd>{a.voucherHint ? `ends in …${a.voucherHint}` : '—'}</dd>
        <dt>Usage</dt>
        <dd className="muted">{a.usage.note}</dd>
      </dl>
      {a.state === 'ACCESS_BEING_CONFIGURED' ? (
        <p className="muted small">
          The property network hasn&apos;t confirmed this access yet. It will switch to “Connected”
          when it does.
        </p>
      ) : null}
      {canRenew ? (
        <p>
          <Link
            className="button"
            href={`/account/plans?renew=${a.entitlementId}&plan=${a.planId}`}
          >
            Renew (adds time after the current end)
          </Link>
        </p>
      ) : null}
      <AccessManager access={a} />
    </>
  );
}
