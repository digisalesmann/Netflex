'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
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
