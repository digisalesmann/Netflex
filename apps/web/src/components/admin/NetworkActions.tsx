'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { CopyButton } from './CopyButton';
import { ActionForm, Field, Panel, errorText } from './kit';

const base = (p: string) => `/admin/properties/${p}`;
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

/** A button that runs one call and says what happened next to it. */
function RunButton({
  label,
  busyLabel,
  run,
  describe,
}: {
  label: string;
  busyLabel: string;
  run: () => Promise<unknown>;
  describe: (r: unknown) => string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className="adm-inline">
      <button
        type="button"
        className="adm-btn adm-btn--quiet"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setMsg(null);
          run()
            .then((r) => {
              setMsg({ ok: true, text: describe(r) });
              router.refresh();
            })
            .catch((e: unknown) => setMsg({ ok: false, text: errorText(e) }))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? busyLabel : label}
      </button>
      {msg ? (
        <span className="adm-inline__msg" data-ok={msg.ok} role="status">
          {msg.text}
        </span>
      ) : null}
    </span>
  );
}

export function CheckNetwork({ propertyId }: { propertyId: string }) {
  return (
    <RunButton
      label="Run a network check"
      busyLabel="Checking…"
      run={() => api(`${base(propertyId)}/network/reconcile`, { method: 'POST' })}
      describe={(r) => {
        const x = r as { reachable?: boolean; sessionsSeen?: number; drift?: number };
        if (!x.reachable) return 'The Wi-Fi equipment didn’t answer.';
        return `Checked. ${x.sessionsSeen ?? 0} devices online${x.drift ? `, ${x.drift} fixed` : ''}.`;
      }}
    />
  );
}

export function CheckGateway({ propertyId, gatewayId }: { propertyId: string; gatewayId: string }) {
  return (
    <RunButton
      label="Check now"
      busyLabel="Checking…"
      run={() => api(`${base(propertyId)}/gateways/${gatewayId}/health-check`, { method: 'POST' })}
      describe={(r) =>
        (r as { reachable?: boolean } | null)?.reachable
          ? 'It answered. Working normally.'
          : 'It didn’t answer.'
      }
    />
  );
}

export function GatewaySwitch({
  propertyId,
  gatewayId,
  disabled,
}: {
  propertyId: string;
  gatewayId: string;
  disabled: boolean;
}) {
  const action = disabled ? 'enable' : 'disable';
  return (
    <Panel
      label={disabled ? 'Turn on' : 'Turn off'}
      title={disabled ? 'Turn this equipment back on?' : 'Turn this equipment off in the system?'}
      lede={
        disabled
          ? 'The system starts sending it instructions again.'
          : 'The system stops sending it instructions (for maintenance). People online stay online.'
      }
      tone={disabled ? 'solid' : 'danger'}
    >
      {(close) => (
        <ActionForm
          cta={disabled ? 'Turn on' : 'Turn off'}
          tone={disabled ? 'solid' : 'danger'}
          done={close}
          submit={(f) =>
            api(`${base(propertyId)}/gateways/${gatewayId}/${action}`, {
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

export function RetryJob({ propertyId, operationId }: { propertyId: string; operationId: string }) {
  return (
    <Panel
      label="Try again"
      title="Try this job again?"
      lede="It re-applies what the plan should be right now, so it’s safe to repeat."
      tone="quiet"
    >
      {(close) => (
        <ActionForm
          cta="Try again"
          done={close}
          submit={(f) =>
            api(`${base(propertyId)}/network/operations/${operationId}/retry`, {
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

/** Register the lodge's Omada controller (its credentials stay on the lodge computer). */
export function AddOmada({ propertyId }: { propertyId: string }) {
  return (
    <Panel
      label="Add Omada controller"
      title="Add the Omada controller"
      lede="The controller runs on the lodge computer. Its passwords stay there; this only names it."
    >
      {(close) => (
        <ActionForm
          cta="Add controller"
          done={close}
          submit={(f) =>
            api(`${base(propertyId)}/gateways`, {
              method: 'POST',
              body: {
                name: str(f, 'name'),
                vendor: 'OMADA',
                ...(str(f, 'model') ? { model: str(f, 'model') } : {}),
              },
            })
          }
        >
          <Field label="Name">
            <input
              name="name"
              required
              minLength={2}
              maxLength={80}
              defaultValue="Omada controller"
            />
          </Field>
          <Field label="Equipment (optional)" hint="For your records, e.g. 3× EAP115 v4.">
            <input name="model" maxLength={80} autoComplete="off" />
          </Field>
        </ActionForm>
      )}
    </Panel>
  );
}

/** One-time code to type into the lodge link on the lodge computer. */
export function PairLink({
  propertyId,
  gatewayId,
  paired,
}: {
  propertyId: string;
  gatewayId: string;
  paired: boolean;
}) {
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  return (
    <Panel
      label={paired ? 'Pair again' : 'Pair lodge link'}
      title={code ? 'Your pairing code' : 'Pair the lodge link'}
      lede={
        code
          ? undefined
          : paired
            ? 'Use this when the lodge computer was replaced. The old link stops working once the new one pairs.'
            : 'Makes a one-time code for the lodge computer. It works once, within 30 minutes.'
      }
      tone={paired ? 'quiet' : 'solid'}
    >
      {(close) =>
        code ? (
          <div className="adm-pair">
            <div className="adm-qr__row">
              <code className="adm-pair__code">{code.code}</code>
              <CopyButton value={code.code} label="pairing code" />
            </div>
            <p className="adm-sub">
              On the lodge computer, in the lodge link folder, run:
              <br />
              <code>node lodge-link.mjs pair {code.code}</code>
            </p>
            <p className="adm-sub">
              Works once, until{' '}
              {new Intl.DateTimeFormat('en-NG', {
                hour: 'numeric',
                minute: '2-digit',
                timeZone: 'Africa/Lagos',
              }).format(new Date(code.expiresAt))}
              . This page shows the link as online within a minute.
            </p>
            <div className="adm-form__bar">
              <button
                type="button"
                className="adm-btn adm-btn--solid"
                onClick={() => {
                  setCode(null);
                  close();
                }}
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <ActionForm
            cta="Make a pairing code"
            refresh={false}
            done={(r) => setCode(r as { code: string; expiresAt: string })}
            submit={() =>
              api(`${base(propertyId)}/gateways/${gatewayId}/link-code`, { method: 'POST' })
            }
          >
            <p className="adm-sub">
              First install the lodge link on the computer that runs the Omada controller (
              <a href="/downloads/lodge-link.zip" download>
                download it here
              </a>
              , then follow README.txt inside).
            </p>
          </ActionForm>
        )
      }
    </Panel>
  );
}

export function UnpairLink({ propertyId, gatewayId }: { propertyId: string; gatewayId: string }) {
  return (
    <Panel
      label="Disconnect link"
      title="Disconnect the lodge link?"
      lede="Use this if the lodge computer is lost or replaced. Nobody new can be switched on until a link is paired again; people already online stay online until their plan ends."
      tone="danger"
    >
      {(close) => (
        <ActionForm
          cta="Disconnect"
          tone="danger"
          done={close}
          submit={(f) =>
            api(`${base(propertyId)}/gateways/${gatewayId}/link-unpair`, {
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
