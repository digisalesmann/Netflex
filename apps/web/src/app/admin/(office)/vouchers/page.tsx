import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  IssueVouchers,
  ReissueVoucher,
  VoucherAction,
  type IssuablePlan,
} from '@/components/admin/VoucherActions';
import { adminApi, allowed, currentProperty, requireStaff } from '@/lib/admin';
import { byLabel, propertyStructure, shortDate } from '@/lib/admin-data';
import { versionsOf, type PlanDetail } from '@/lib/admin-plans';
import { serverApi } from '@/lib/server-api';

export const metadata = { title: 'Vouchers' };

type Params = Promise<Record<string, string | string[] | undefined>>;

interface VoucherRow {
  id: string;
  hint: string;
  status: string;
  issuanceType: 'PAID' | 'COMPLIMENTARY' | 'MANUAL' | 'PROMOTIONAL';
  scope: string;
  issuedAt: string | null;
  activatedAt: string | null;
  redeemBy: string | null;
  issueReason: string | null;
  issuedBy: { displayName: string } | null;
  activeDevices: number;
  planName: string | null;
  expiresAt: string | null;
}

const STATUS: Record<string, { label: string; tone: string }> = {
  ISSUED: { label: 'Not used yet', tone: 'info' },
  GENERATED: { label: 'Not used yet', tone: 'info' },
  ACTIVE: { label: 'In use', tone: 'ok' },
  SUSPENDED: { label: 'Suspended', tone: 'warn' },
  EXHAUSTED: { label: 'Used up', tone: 'muted' },
  EXPIRED: { label: 'Ended', tone: 'muted' },
  REVOKED: { label: 'Cancelled', tone: 'bad' },
};
const TYPE = {
  PAID: 'Paid online',
  MANUAL: 'Paid at desk',
  COMPLIMENTARY: 'Free',
  PROMOTIONAL: 'Promotion',
} as const;
const TABS = [
  { id: '', label: 'All' },
  { id: 'ISSUED', label: 'Not used yet' },
  { id: 'ACTIVE', label: 'In use' },
  { id: 'SUSPENDED', label: 'Suspended' },
  { id: 'REVOKED', label: 'Cancelled' },
];

export default async function VouchersPage({ searchParams }: { searchParams: Params }) {
  const me = await requireStaff('/admin/vouchers');
  const { property } = await currentProperty();
  if (!property || !allowed(me, 'voucher.read', property.id)) redirect('/admin');
  const q = await searchParams;
  const status = typeof q.status === 'string' && STATUS[q.status] ? q.status : '';
  const hint =
    typeof q.q === 'string'
      ? q.q
          .trim()
          .toUpperCase()
          .replace(/[^0-9A-Z]/g, '')
          .slice(-4)
      : '';
  const canIssue = allowed(me, 'voucher.issue', property.id);
  const canManage = allowed(me, 'voucher.manage', property.id);

  const qs = new URLSearchParams({ limit: '100' });
  if (status) qs.set('status', status);
  if (hint.length === 4) qs.set('hint', hint);
  const rows =
    (
      await serverApi<VoucherRow[]>(`/admin/properties/${property.id}/vouchers?${qs}`, {
        auth: true,
      })
    ).data ?? [];

  // For "Make vouchers": plans on sale, and rooms/floors for room or floor plans.
  let issuable: IssuablePlan[] = [];
  let rooms: { id: string; label: string }[] = [];
  let floors: { id: string; label: string }[] = [];
  if (canIssue) {
    const list = (await adminApi<{ id: string }[]>(property.id, '/plans')).data ?? [];
    const details = await Promise.all(
      list.map((p) => adminApi<PlanDetail>(property.id, `/plans/${p.id}`)),
    );
    issuable = details
      .map((r) => r.data)
      .filter((p): p is PlanDetail => p?.status === 'PUBLISHED')
      .flatMap((p) => {
        const { live } = versionsOf(p);
        return live
          ? [
              {
                versionId: live.planVersionId,
                name: live.name,
                scope: live.scope,
                price: live.price.display.replace(/\.00$/, ''),
              },
            ]
          : [];
      });
    const s = await propertyStructure(property.id);
    const fl = s?.buildings.flatMap((b) => b.floors) ?? [];
    floors = fl.map((f) => ({ id: f.id, label: f.label }));
    rooms = fl
      .flatMap((f) => f.rooms.map((r) => ({ id: r.id, label: `Room ${r.label}` })))
      .sort((a, b) => byLabel({ label: a.label }, { label: b.label }));
  }

  return (
    <>
      <header className="adm-head adm-head--row">
        <div>
          <p className="adm-head__eyebrow">{property.name}</p>
          <h1 className="adm-head__title">Vouchers</h1>
          <p className="adm-head__lede">
            Codes for the Wi-Fi sign-in page. For security, only the last 4 characters are kept.
          </p>
        </div>
        {canIssue && issuable.length ? (
          <IssueVouchers propertyId={property.id} plans={issuable} rooms={rooms} floors={floors} />
        ) : null}
      </header>

      <div className="adm-toolbar">
        <form className="adm-search" role="search" action="/admin/vouchers">
          <label className="adm-sr" htmlFor="q">
            Find a code by its last 4 characters
          </label>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4" />
          </svg>
          <input
            id="q"
            name="q"
            defaultValue={hint}
            placeholder="Last 4 characters, e.g. 7K2P"
            autoComplete="off"
            autoCapitalize="characters"
            maxLength={14}
          />
          {status ? <input type="hidden" name="status" value={status} /> : null}
        </form>
        <nav className="adm-tabs adm-tabs--scroll" aria-label="Filter vouchers">
          {TABS.map((t) => (
            <Link
              key={t.id || 'all'}
              href={`/admin/vouchers?${new URLSearchParams({
                ...(t.id ? { status: t.id } : {}),
                ...(hint ? { q: hint } : {}),
              })}`}
              aria-current={status === t.id ? 'page' : undefined}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </div>

      {hint && hint.length < 4 ? (
        <p className="adm-empty">Type all 4 last characters of the code.</p>
      ) : rows.length ? (
        <ul className="adm-vouchers">
          {rows.map((v) => {
            const st = STATUS[v.status] ?? { label: v.status, tone: 'muted' };
            const live = !['REVOKED', 'EXPIRED', 'EXHAUSTED'].includes(v.status);
            return (
              <li key={v.id} className="adm-voucher">
                <span className="adm-voucher__code" aria-label={`Code ending ${v.hint}`}>
                  <span aria-hidden="true">••••-••••-</span>
                  {v.hint}
                </span>
                <span className="adm-voucher__main">
                  <strong>{v.planName ?? 'Plan'}</strong>
                  <span>
                    {TYPE[v.issuanceType]}
                    {v.issuedAt ? ` · ${shortDate(v.issuedAt)}` : ''}
                    {v.issuedBy ? ` · by ${v.issuedBy.displayName}` : ''}
                  </span>
                  {v.status === 'ACTIVE' && v.expiresAt ? (
                    <span>
                      Ends {shortDate(v.expiresAt)} · {v.activeDevices}{' '}
                      {v.activeDevices === 1 ? 'device' : 'devices'}
                    </span>
                  ) : v.status === 'ISSUED' && v.redeemBy ? (
                    <span>Use by {shortDate(v.redeemBy)}</span>
                  ) : null}
                </span>
                <span className="adm-tag" data-tone={st.tone}>
                  {st.label}
                </span>
                {canManage && live ? (
                  <span className="adm-voucher__actions">
                    {v.status === 'SUSPENDED' ? (
                      <VoucherAction propertyId={property.id} voucherId={v.id} action="reinstate" />
                    ) : (
                      <VoucherAction propertyId={property.id} voucherId={v.id} action="suspend" />
                    )}
                    <ReissueVoucher propertyId={property.id} voucherId={v.id} />
                    <VoucherAction propertyId={property.id} voucherId={v.id} action="revoke" />
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="adm-empty">
          {hint
            ? `No code ends in ${hint}.`
            : status
              ? 'No vouchers here.'
              : 'No vouchers yet. Make some to hand out at the front desk.'}
        </p>
      )}
    </>
  );
}
