'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Select } from '../Select';
import { ActionForm, Field, Panel } from './kit';

const base = (p: string) => `/admin/properties/${p}/vouchers`;
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

export interface IssuablePlan {
  versionId: string;
  name: string;
  scope: 'INDIVIDUAL' | 'ROOM' | 'FLOOR';
  price: string;
}
export interface Target {
  id: string;
  label: string;
}

type Issued = { voucherId: string; code: string; redeemBy: string | null };

/** Codes are shown exactly once: copy, print, then they're gone for good. */
function NewCodes({ codes, plan, onDone }: { codes: Issued[]; plan: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = codes.map((c) => c.code).join('\n');
  return (
    <div className="adm-codes">
      <p className="adm-codes__warn" role="status">
        <strong>Copy or print these now.</strong> For security they can&apos;t be shown again.
      </p>
      <ol className="adm-codes__list" aria-label={`${codes.length} new ${plan} codes`}>
        {codes.map((c) => (
          <li key={c.voucherId}>
            <code>{c.code}</code>
            {c.redeemBy ? (
              <span>
                use by{' '}
                {new Intl.DateTimeFormat('en-NG', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                  timeZone: 'Africa/Lagos',
                }).format(new Date(c.redeemBy))}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      <div className="adm-actions">
        <button
          type="button"
          className="adm-btn adm-btn--quiet"
          onClick={() =>
            void navigator.clipboard
              .writeText(text)
              .then(() => setCopied(true))
              .catch(() => null)
          }
        >
          {copied ? 'Copied' : codes.length > 1 ? 'Copy all' : 'Copy code'}
        </button>
        <button type="button" className="adm-btn adm-btn--quiet" onClick={() => window.print()}>
          Print
        </button>
        <button type="button" className="adm-btn adm-btn--solid" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

const TYPES = [
  { value: 'MANUAL', label: 'Paid at the front desk', hint: 'Cash or transfer to the office' },
  { value: 'COMPLIMENTARY', label: 'Free', hint: 'A gift, or to make up for an outage' },
  { value: 'PROMOTIONAL', label: 'Promotion', hint: 'Part of an offer' },
];

export function IssueVouchers({
  propertyId,
  plans,
  rooms,
  floors,
}: {
  propertyId: string;
  plans: IssuablePlan[];
  rooms: Target[];
  floors: Target[];
}) {
  const router = useRouter();
  const [planId, setPlanId] = useState(plans[0]?.versionId ?? '');
  const [issued, setIssued] = useState<{ codes: Issued[]; plan: string } | null>(null);
  const plan = plans.find((p) => p.versionId === planId);
  return (
    <Panel
      label="Make vouchers"
      title={issued ? 'Your new codes' : 'Make voucher codes'}
      lede={
        issued ? undefined : 'Hand them out at the front desk. Each code works like a bought plan.'
      }
    >
      {(close) =>
        issued ? (
          <NewCodes
            codes={issued.codes}
            plan={issued.plan}
            onDone={() => {
              setIssued(null);
              close();
              router.refresh();
            }}
          />
        ) : (
          <ActionForm
            cta="Make codes"
            busyCta="Making…"
            refresh={false}
            submit={async (f) => {
              if (!plan) throw new Error('Choose a plan.');
              const quantity = Number(str(f, 'quantity') || '1');
              if (!(quantity >= 1 && quantity <= 50))
                throw new Error('Make between 1 and 50 codes.');
              const target =
                plan.scope === 'INDIVIDUAL'
                  ? { scope: 'INDIVIDUAL' as const }
                  : plan.scope === 'ROOM'
                    ? { scope: 'ROOM' as const, roomId: str(f, 'targetId') }
                    : { scope: 'FLOOR' as const, floorId: str(f, 'targetId') };
              if (plan.scope !== 'INDIVIDUAL' && !str(f, 'targetId'))
                throw new Error(plan.scope === 'ROOM' ? 'Choose a room.' : 'Choose a floor.');
              const r = await api<{ vouchers: Issued[] }>(base(propertyId), {
                method: 'POST',
                body: {
                  planVersionId: plan.versionId,
                  issuanceType: str(f, 'type') || 'MANUAL',
                  reason: str(f, 'reason'),
                  target,
                  quantity,
                  ...(quantity > 1 ? { confirmBulk: true } : {}),
                },
              });
              setIssued({ codes: r.vouchers, plan: plan.name });
              return r;
            }}
          >
            <Field label="Plan">
              <Select
                value={planId}
                onChange={setPlanId}
                options={plans.map((p) => ({ value: p.versionId, label: p.name, hint: p.price }))}
              />
            </Field>
            {plan?.scope === 'ROOM' ? (
              <Field label="For room">
                <Select
                  name="targetId"
                  placeholder="Choose a room"
                  options={rooms.map((r) => ({ value: r.id, label: r.label }))}
                />
              </Field>
            ) : null}
            {plan?.scope === 'FLOOR' ? (
              <Field label="For floor">
                <Select
                  name="targetId"
                  placeholder="Choose a floor"
                  options={floors.map((r) => ({ value: r.id, label: r.label }))}
                />
              </Field>
            ) : null}
            <Field label="Type">
              <Select name="type" defaultValue="MANUAL" options={TYPES} />
            </Field>
            <Field label="How many" hint="Up to 50 at a time.">
              <input name="quantity" type="number" min={1} max={50} defaultValue={1} required />
            </Field>
            <Field label="Note" hint="Saved in the activity log, e.g. paid cash, room 12.">
              <input name="reason" required minLength={3} maxLength={500} autoComplete="off" />
            </Field>
          </ActionForm>
        )
      }
    </Panel>
  );
}

const ACTIONS = {
  suspend: {
    label: 'Suspend',
    title: 'Suspend this code?',
    lede: 'It stops working until you reinstate it. Time on the plan keeps running.',
    cta: 'Suspend',
    tone: 'quiet' as const,
  },
  reinstate: {
    label: 'Reinstate',
    title: 'Reinstate this code?',
    lede: 'It works again straight away.',
    cta: 'Reinstate',
    tone: 'solid' as const,
  },
  revoke: {
    label: 'Cancel code',
    title: 'Cancel this code for good?',
    lede: 'It stops working and can’t be undone. Devices using it are disconnected.',
    cta: 'Cancel code',
    tone: 'danger' as const,
  },
};

export function VoucherAction({
  propertyId,
  voucherId,
  action,
}: {
  propertyId: string;
  voucherId: string;
  action: keyof typeof ACTIONS;
}) {
  const a = ACTIONS[action];
  return (
    <Panel label={a.label} title={a.title} lede={a.lede} tone={a.tone}>
      {(close) => (
        <ActionForm
          cta={a.cta}
          tone={a.tone === 'danger' ? 'danger' : 'solid'}
          done={close}
          submit={(f) =>
            api(`${base(propertyId)}/${voucherId}/${action}`, {
              method: 'POST',
              body: { reason: str(f, 'reason') },
            })
          }
        >
          <Field label="Reason" hint="Saved in the activity log.">
            <input name="reason" required minLength={3} maxLength={500} autoComplete="off" />
          </Field>
        </ActionForm>
      )}
    </Panel>
  );
}

/** Lost or leaked code: cancel it and give a new one for the same plan and time. */
export function ReissueVoucher({
  propertyId,
  voucherId,
}: {
  propertyId: string;
  voucherId: string;
}) {
  const router = useRouter();
  const [code, setCode] = useState<Issued | null>(null);
  return (
    <Panel
      label="Replace code"
      title={code ? 'The new code' : 'Replace this code?'}
      lede={
        code
          ? undefined
          : 'For a lost or shared code. The old one stops working; the plan and its time carry over.'
      }
      tone="quiet"
    >
      {(close) =>
        code ? (
          <NewCodes
            codes={[code]}
            plan="replacement"
            onDone={() => {
              setCode(null);
              close();
              router.refresh();
            }}
          />
        ) : (
          <ActionForm
            cta="Replace code"
            refresh={false}
            submit={async (f) => {
              const r = await api<{ voucherId: string; code: string; redeemBy?: string | null }>(
                `${base(propertyId)}/${voucherId}/reissue`,
                { method: 'POST', body: { reason: str(f, 'reason') } },
              );
              setCode({ voucherId: r.voucherId, code: r.code, redeemBy: r.redeemBy ?? null });
              return r;
            }}
          >
            <Field label="Reason" hint="Saved in the activity log.">
              <input name="reason" required minLength={3} maxLength={500} autoComplete="off" />
            </Field>
          </ActionForm>
        )
      }
    </Panel>
  );
}
