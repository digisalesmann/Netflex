'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { errorText } from './kit';

type Status = 'OPEN' | 'IN_PROGRESS' | 'WAITING_ON_CUSTOMER' | 'RESOLVED' | 'CLOSED';

/** One-tap status changes for a support request. */
export function TicketActions({
  propertyId,
  ticketId,
  status,
  mine,
  taken,
}: {
  propertyId: string;
  ticketId: string;
  status: Status;
  /** Assigned to the signed-in staff member. */
  mine: boolean;
  /** Assigned to anyone. */
  taken: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (body: { status?: Status; assignToMe?: boolean }) => {
    setBusy(true);
    setError(null);
    api(`/admin/properties/${propertyId}/tickets/${ticketId}`, { method: 'POST', body })
      .then(() => router.refresh())
      .catch((e: unknown) => setError(errorText(e)))
      .finally(() => setBusy(false));
  };
  const open = status !== 'RESOLVED' && status !== 'CLOSED';
  const B = ({
    label,
    body,
    tone = 'quiet',
  }: {
    label: string;
    body: Parameters<typeof run>[0];
    tone?: string;
  }) => (
    <button
      type="button"
      className={`adm-btn adm-btn--${tone}`}
      disabled={busy}
      onClick={() => run(body)}
    >
      {label}
    </button>
  );
  return (
    <span className="adm-ticket__actions">
      {open && !taken ? (
        <B label="Take it" body={{ assignToMe: true, status: 'IN_PROGRESS' }} tone="solid" />
      ) : null}
      {open && mine ? <B label="Hand back" body={{ assignToMe: false, status: 'OPEN' }} /> : null}
      {open && status !== 'WAITING_ON_CUSTOMER' ? (
        <B label="Waiting on resident" body={{ status: 'WAITING_ON_CUSTOMER' }} />
      ) : null}
      {open ? <B label="Resolved" body={{ status: 'RESOLVED' }} /> : null}
      {!open ? <B label="Reopen" body={{ status: 'OPEN' }} /> : null}
      {error ? (
        <span className="adm-inline__msg" data-ok="false" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
