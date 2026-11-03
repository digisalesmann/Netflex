'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import type { PublicPlan } from '@/lib/types';
import { Select } from '../Select';
import { ActionForm, Field, Panel } from './kit';

const base = (p: string) => `/admin/properties/${p}/plans`;
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const int = (f: FormData, k: string) => {
  const v = str(f, k);
  return v === '' ? null : Number(v);
};

const DEFAULT_REFUND =
  'Full refund before you first use the code. After that, refunds are decided case by case, for example after a long outage you reported.';
const DEFAULT_FAIR_USE =
  'Shared satellite connection: please avoid very large downloads at busy times.';

type Scope = 'INDIVIDUAL' | 'ROOM' | 'FLOOR';

/** The plan's terms as the API expects them (one version). */
function versionFrom(f: FormData, scope: Scope, startsOn: string) {
  const name = str(f, 'name');
  const price = str(f, 'price').replace(/[₦,\s]/g, '');
  const devices = int(f, 'maxDevices') ?? 1;
  const down = int(f, 'downMbps');
  const up = int(f, 'upMbps');
  const check = (ok: boolean, msg: string) => {
    if (!ok) throw new Error(msg);
  };
  check(name.length >= 2, 'Give the plan a name.');
  check(/^\d{1,15}(\.\d{1,2})?$/.test(price) && Number(price) > 0, 'Enter a price, e.g. 2500.');
  check((int(f, 'durationValue') ?? 0) > 0, 'Enter how long it lasts.');
  check(devices >= 1, 'At least 1 device.');
  return {
    name,
    description: str(f, 'description') || name,
    scope,
    price,
    duration: { value: int(f, 'durationValue') ?? 1, unit: str(f, 'durationUnit') || 'DAY' },
    activationPolicy: startsOn,
    redemptionWindow:
      startsOn === 'ON_FIRST_REDEMPTION'
        ? { value: int(f, 'useWithinDays') ?? 30, unit: 'DAY' }
        : null,
    maxDevices: devices,
    maxConcurrentSessions: Math.min(devices, int(f, 'maxOnline') ?? devices),
    downloadKbps: down ? down * 1000 : null,
    uploadKbps: up ? up * 1000 : null,
    maxGroupMembers: scope === 'INDIVIDUAL' ? null : (int(f, 'maxGroupMembers') ?? 4),
    renewalRule: 'STACK_AFTER_CURRENT_EXPIRY',
    availableFrom: null,
    availableUntil: null,
    fairUseText: str(f, 'fairUse') || null,
    refundPolicyText: str(f, 'refund') || DEFAULT_REFUND,
    termsVersion: new Date().toISOString().slice(0, 7),
  };
}

function PlanFields({ plan }: { plan?: PublicPlan }) {
  const [scope, setScope] = useState<Scope>(plan?.scope ?? 'INDIVIDUAL');
  const [startsOn, setStartsOn] = useState<string>(plan?.activationPolicy ?? 'ON_FIRST_REDEMPTION');
  const unit =
    plan?.duration.unit === 'CALENDAR_MONTH' ? 'CALENDAR_MONTH' : (plan?.duration.unit ?? 'DAY');
  return (
    <>
      <input type="hidden" name="scope" value={scope} />
      <input type="hidden" name="startsOn" value={startsOn} />
      <Field label="Name" hint="What residents see, e.g. Weekly.">
        <input name="name" required maxLength={80} defaultValue={plan?.name} autoComplete="off" />
      </Field>
      <Field label="Short description">
        <input
          name="description"
          maxLength={1000}
          defaultValue={plan?.description}
          autoComplete="off"
          placeholder="e.g. Seven days online."
        />
      </Field>
      <div className="adm-pair">
        <Field label="Price (₦)">
          <input
            name="price"
            inputMode="decimal"
            required
            defaultValue={plan ? String(Number(plan.price.amountMinor) / 100) : ''}
            placeholder="2500"
          />
        </Field>
        <Field label="Who it’s for">
          <Select
            value={scope}
            onChange={(v) => setScope(v as Scope)}
            options={[
              { value: 'INDIVIDUAL', label: 'One person' },
              { value: 'ROOM', label: 'A whole room' },
              { value: 'FLOOR', label: 'A whole floor' },
            ]}
          />
        </Field>
      </div>
      <div className="adm-pair">
        <Field label="Lasts">
          <input
            name="durationValue"
            type="number"
            min={1}
            required
            defaultValue={plan?.duration.value ?? 1}
          />
        </Field>
        <Field label="Unit">
          <Select
            name="durationUnit"
            defaultValue={unit}
            options={[
              { value: 'HOUR', label: 'Hours' },
              { value: 'DAY', label: 'Days' },
              { value: 'WEEK', label: 'Weeks' },
              { value: 'CALENDAR_MONTH', label: 'Months' },
            ]}
          />
        </Field>
      </div>
      <div className="adm-pair">
        <Field label="Devices">
          <input
            name="maxDevices"
            type="number"
            min={1}
            max={500}
            required
            defaultValue={plan?.maxDevices ?? 1}
          />
        </Field>
        <Field label="Online at once">
          <input
            name="maxOnline"
            type="number"
            min={1}
            max={500}
            defaultValue={plan?.maxConcurrentSessions ?? 1}
          />
        </Field>
      </div>
      {scope !== 'INDIVIDUAL' ? (
        <Field label="People who can share it" hint="Residents the buyer can add.">
          <input
            name="maxGroupMembers"
            type="number"
            min={1}
            max={500}
            defaultValue={plan?.maxGroupMembers ?? 4}
          />
        </Field>
      ) : null}
      <Field label="Time starts">
        <Select
          value={startsOn}
          onChange={setStartsOn}
          options={[
            { value: 'ON_FIRST_REDEMPTION', label: 'When they first use the code' },
            { value: 'ON_PURCHASE', label: 'As soon as they pay' },
          ]}
        />
      </Field>
      {startsOn === 'ON_FIRST_REDEMPTION' ? (
        <Field label="Use the code within (days)">
          <input
            name="useWithinDays"
            type="number"
            min={1}
            max={365}
            defaultValue={plan?.redemptionWindow?.value ?? 30}
          />
        </Field>
      ) : null}
      <div className="adm-pair">
        <Field label="Speed cap down (Mbps)" hint="Leave empty for no cap.">
          <input
            name="downMbps"
            type="number"
            min={1}
            defaultValue={plan?.speed.downloadKbps ? plan.speed.downloadKbps / 1000 : ''}
          />
        </Field>
        <Field label="Speed cap up (Mbps)">
          <input
            name="upMbps"
            type="number"
            min={1}
            defaultValue={plan?.speed.uploadKbps ? plan.speed.uploadKbps / 1000 : ''}
          />
        </Field>
      </div>
      <Field label="Fair use note (optional)">
        <textarea
          name="fairUse"
          maxLength={2000}
          defaultValue={plan?.fairUseText ?? DEFAULT_FAIR_USE}
        />
      </Field>
      <Field label="Refund terms" hint="Shown to buyers before they pay.">
        <textarea
          name="refund"
          maxLength={2000}
          defaultValue={plan?.refundPolicyText ?? DEFAULT_REFUND}
        />
      </Field>
      <label className="adm-check">
        <input type="checkbox" name="publish" defaultChecked />
        Put it on sale now
      </label>
    </>
  );
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50) || 'plan';

export function NewPlan({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  return (
    <Panel
      label="New plan"
      title="Create a plan"
      lede="Prices are in naira. You can change anything later."
    >
      {(close) => (
        <ActionForm
          cta="Create plan"
          busyCta="Creating…"
          done={(r) => {
            close();
            const id = (r as { planId?: string } | null)?.planId;
            if (id) router.push(`/admin/plans/${id}`);
          }}
          submit={async (f) => {
            const v = versionFrom(f, str(f, 'scope') as Scope, str(f, 'startsOn'));
            const slug = `${slugify(v.name)}-${Date.now().toString(36).slice(-4)}`;
            const r = await api<{ planId: string; versionId: string }>(base(propertyId), {
              method: 'POST',
              body: { slug, version: v },
            });
            if (f.get('publish'))
              await api(`${base(propertyId)}/${r.planId}/versions/${r.versionId}/publish`, {
                method: 'POST',
              });
            return r;
          }}
        >
          <PlanFields />
        </ActionForm>
      )}
    </Panel>
  );
}

export function EditPlan({
  propertyId,
  planId,
  plan,
}: {
  propertyId: string;
  planId: string;
  plan: PublicPlan;
}) {
  return (
    <Panel
      label="Change price or terms"
      title={`Change ${plan.name}`}
      lede="This makes a new version. People who already bought keep the terms they paid for."
    >
      {(close) => (
        <ActionForm
          cta="Save new version"
          done={close}
          submit={async (f) => {
            const v = versionFrom(f, str(f, 'scope') as Scope, str(f, 'startsOn'));
            const r = await api<{ versionId: string }>(`${base(propertyId)}/${planId}/versions`, {
              method: 'POST',
              body: v,
            });
            if (f.get('publish'))
              await api(`${base(propertyId)}/${planId}/versions/${r.versionId}/publish`, {
                method: 'POST',
              });
            return r;
          }}
        >
          <PlanFields plan={plan} />
        </ActionForm>
      )}
    </Panel>
  );
}

export function PublishVersion({
  propertyId,
  planId,
  versionId,
  version,
}: {
  propertyId: string;
  planId: string;
  versionId: string;
  version: number;
}) {
  return (
    <Panel
      label={`Put version ${version} on sale`}
      title={`Put version ${version} on sale?`}
      lede="New buyers get these terms from now on. People who already bought keep theirs."
    >
      {(close) => (
        <ActionForm
          cta="Put on sale"
          done={close}
          submit={() =>
            api(`${base(propertyId)}/${planId}/versions/${versionId}/publish`, { method: 'POST' })
          }
        >
          <span />
        </ActionForm>
      )}
    </Panel>
  );
}

const STATUS_ACTION = {
  pause: {
    label: 'Pause sales',
    title: 'Pause sales of this plan?',
    lede: 'It disappears from the site and the Wi-Fi sign-in page. Codes already sold keep working.',
    cta: 'Pause sales',
    tone: 'quiet' as const,
  },
  resume: {
    label: 'Resume sales',
    title: 'Put this plan back on sale?',
    lede: 'It shows on the site and the Wi-Fi sign-in page again.',
    cta: 'Resume sales',
    tone: 'solid' as const,
  },
  archive: {
    label: 'Archive',
    title: 'Archive this plan?',
    lede: 'It stops being sold for good and can’t be changed. Codes already sold keep working.',
    cta: 'Archive plan',
    tone: 'danger' as const,
  },
};

export function PlanStatus({
  propertyId,
  planId,
  action,
}: {
  propertyId: string;
  planId: string;
  action: keyof typeof STATUS_ACTION;
}) {
  const a = STATUS_ACTION[action];
  return (
    <Panel label={a.label} title={a.title} lede={a.lede} tone={a.tone}>
      {(close) => (
        <ActionForm
          cta={a.cta}
          tone={a.tone === 'danger' ? 'danger' : 'solid'}
          done={close}
          submit={(f) =>
            api(`${base(propertyId)}/${planId}/${action}`, {
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
