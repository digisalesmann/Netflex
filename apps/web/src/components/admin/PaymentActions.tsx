'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { ActionForm, Field, Panel, errorText } from './kit';

const base = (p: string) => `/admin/properties/${p}`;
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

const OUTCOME: Record<string, string> = {
  SUCCEEDED_FULFILLED: 'Paystack confirms it was paid. The plan is switched on.',
  SUCCEEDED_DISCREPANCY: 'Paystack says it was paid, but something doesn’t match. See Mismatches.',
  FAILED: 'Paystack says this payment failed.',
  ABANDONED: 'The buyer didn’t finish paying.',
  EXPIRED: 'The payment window expired before it was paid.',
  MISMATCH: 'The amount or details don’t match. See Mismatches.',
  STILL_PENDING: 'Still pending at Paystack. Try again in a few minutes.',
  ALREADY_FINAL: 'Already settled. Nothing changed.',
  NOT_FOUND: 'Payment not found.',
};

/** Ask Paystack again right now, e.g. when a buyer says they paid. */
export function VerifyPayment({
  propertyId,
  paymentId,
}: {
  propertyId: string;
  paymentId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="adm-inline">
      <button
        type="button"
        className="adm-btn adm-btn--quiet"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setMsg(null);
          api<{ outcome: unknown }>(`${base(propertyId)}/payments/${paymentId}/verify`, {
            method: 'POST',
          })
            .then((r) => {
              const key = typeof r.outcome === 'string' ? r.outcome : '';
              setMsg({ ok: true, text: OUTCOME[key] ?? 'Checked with Paystack.' });
              router.refresh();
            })
            .catch((e: unknown) => setMsg({ ok: false, text: errorText(e) }))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? 'Checking…' : 'Check with Paystack'}
      </button>
      {msg ? (
        <span className="adm-inline__msg" data-ok={msg.ok} role="status">
          {msg.text}
        </span>
      ) : null}
    </div>
  );
}

export function RequestRefund({
  propertyId,
  paymentId,
  maxMajor,
  display,
}: {
  propertyId: string;
  paymentId: string;
  /** Most that can still be refunded, in naira, e.g. "2500". */
  maxMajor: string;
  display: string;
}) {
  return (
    <Panel
      label="Refund"
      title="Request a refund"
      lede={`Up to ${display} can be refunded. Another staff member must approve it before money moves.`}
      tone="quiet"
    >
      {(close) => (
        <ActionForm
          cta="Request refund"
          done={close}
          submit={(f) => {
            const amount = str(f, 'amount').replace(/[₦,\s]/g, '');
            if (!/^\d{1,15}(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0)
              throw new Error('Enter an amount, e.g. 2500.');
            if (Number(amount) > Number(maxMajor))
              throw new Error(`That’s more than the ${display} that can be refunded.`);
            return api(`${base(propertyId)}/payments/${paymentId}/refunds`, {
              method: 'POST',
              body: { amount, reason: str(f, 'reason') },
            });
          }}
        >
          <Field label="Amount (₦)" hint="Part refunds are fine.">
            <input name="amount" inputMode="decimal" required defaultValue={maxMajor} />
          </Field>
          <Field label="Reason" hint="Saved in the activity log and shown to the approver.">
            <input name="reason" required minLength={3} maxLength={500} autoComplete="off" />
          </Field>
        </ActionForm>
      )}
    </Panel>
  );
}

export function DecideRefund({
  propertyId,
  refundId,
  amount,
  mine,
}: {
  propertyId: string;
  refundId: string;
  amount: string;
  /** The signed-in staff member asked for it: someone else must approve. */
  mine: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (mine) return <span className="adm-note">Waiting for another staff member to approve.</span>;
  return (
    <span className="adm-decide">
      <Panel
        label="Approve"
        title={`Approve this ${amount} refund?`}
        lede="Paystack sends the money back to the buyer’s card or bank. This can’t be undone."
      >
        {(close) => (
          <div className="adm-form">
            {error ? (
              <p className="adm-form__error" role="alert">
                {error}
              </p>
            ) : null}
            <button
              type="button"
              className="adm-btn adm-btn--solid adm-form__submit"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError(null);
                api(`${base(propertyId)}/refunds/${refundId}/approve`, { method: 'POST' })
                  .then(() => {
                    close();
                    router.refresh();
                  })
                  .catch((e: unknown) => setError(e instanceof ApiError ? e.message : errorText(e)))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? 'Approving…' : `Approve ${amount} refund`}
            </button>
          </div>
        )}
      </Panel>
      <Panel label="Reject" title="Reject this refund?" tone="danger">
        {(close) => (
          <ActionForm
            cta="Reject refund"
            tone="danger"
            done={close}
            submit={(f) =>
              api(`${base(propertyId)}/refunds/${refundId}/reject`, {
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
    </span>
  );
}

export function ResolveMismatch({ propertyId, id }: { propertyId: string; id: string }) {
  return (
    <Panel
      label="Mark as resolved"
      title="Resolve this mismatch"
      lede="Explain what you checked or did. The record is kept with your note."
      tone="quiet"
    >
      {(close) => (
        <ActionForm
          cta="Mark as resolved"
          done={close}
          submit={(f) =>
            api(`${base(propertyId)}/discrepancies/${id}/resolve`, {
              method: 'POST',
              body: { resolution: str(f, 'resolution') },
            })
          }
        >
          <Field label="What happened" hint="At least a few words.">
            <textarea name="resolution" required minLength={5} maxLength={500} />
          </Field>
        </ActionForm>
      )}
    </Panel>
  );
}
