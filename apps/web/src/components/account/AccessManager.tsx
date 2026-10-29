'use client';

import { useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import type { Access } from '@/lib/account';
import { Notice } from '../ui';

export function AccessManager({ access }: { access: Access }) {
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/me/access/${access.entitlementId}`;

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: 'ok', text: ok });
      window.location.reload();
    } catch (e) {
      setMsg({ tone: 'bad', text: e instanceof ApiError ? e.message : 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  }

  async function addMember(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const phone = String(new FormData(e.currentTarget).get('phone') ?? '');
    await run(() => api(`${base}/members`, { method: 'POST', body: { phone } }), 'Member added.');
  }

  return (
    <>
      <div aria-live="polite">{msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}</div>

      <section aria-labelledby="devices" style={{ marginTop: 'var(--nf-space-6)' }}>
        <h2 id="devices" className="h3">
          Devices ({access.devices.inUse} of {access.devices.limit})
        </h2>
        {access.devices.list.length === 0 ? (
          <p className="muted">
            No devices connected yet. Enter your code on the Wi-Fi sign-in page on each device.
          </p>
        ) : (
          <ul className="rows">
            {access.devices.list.map((d) => (
              <li key={d.redemptionId} className="row-head">
                <span>
                  {d.label ?? 'Device'} ending {d.macSuffix}
                  {d.mine ? ' · yours' : ''}
                  <br />
                  <span className="small muted">
                    since {new Date(d.since).toLocaleDateString('en-NG', { dateStyle: 'medium' })}
                  </span>
                </span>
                <button
                  type="button"
                  className="button button--quiet"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => api(`${base}/devices/${d.redemptionId}/release`, { method: 'POST' }),
                      'Device removed. It has been disconnected.',
                    )
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="small muted">
          Removing a device frees its slot so another can connect. You can do this up to 3 times a
          day.
        </p>
      </section>

      {access.members ? (
        <section aria-labelledby="members" style={{ marginTop: 'var(--nf-space-6)' }}>
          <h2 id="members" className="h3">
            People on this plan
          </h2>
          <ul className="rows">
            {access.members.map((m) => (
              <li key={m.membershipId} className="row-head">
                <span>
                  {m.name} · ending {m.phoneSuffix} {m.role === 'MANAGER' ? '· manager' : ''}
                </span>
                {m.role !== 'MANAGER' ? (
                  <span className="actions" style={{ margin: 0 }}>
                    <button
                      type="button"
                      className="button button--quiet"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            api(`${base}/transfer-manager`, {
                              method: 'POST',
                              body: { toUserId: m.userId, reason: 'handed over by manager' },
                            }),
                          'Manager role handed over.',
                        )
                      }
                    >
                      Make manager
                    </button>
                    <button
                      type="button"
                      className="button button--danger"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => api(`${base}/members/${m.membershipId}/remove`, { method: 'POST' }),
                          'Removed. Their devices were disconnected.',
                        )
                      }
                    >
                      Remove
                    </button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <form onSubmit={(e) => void addMember(e)} style={{ marginTop: 'var(--nf-space-4)' }}>
            <div className="field">
              <label htmlFor="member-phone">Add a resident by phone number</label>
              <span className="hint" id="member-hint">
                They must be registered as living{' '}
                {access.scope === 'ROOM' ? 'in this room' : 'on this floor'}.
              </span>
              <input
                id="member-phone"
                name="phone"
                type="tel"
                inputMode="tel"
                required
                aria-describedby="member-hint"
              />
            </div>
            <button className="button" type="submit" disabled={busy}>
              Add
            </button>
          </form>
        </section>
      ) : null}

      {access.role === 'MEMBER' && access.myMembershipId ? (
        <section style={{ marginTop: 'var(--nf-space-6)' }}>
          <h2 className="h3">Leave this plan</h2>
          <p className="muted">Your devices will be disconnected from this plan.</p>
          <LeaveButton
            onLeave={() =>
              run(
                () => api(`${base}/members/${access.myMembershipId}/remove`, { method: 'POST' }),
                'You left the plan.',
              )
            }
            disabled={busy}
          />
        </section>
      ) : null}
    </>
  );
}

function LeaveButton({ onLeave, disabled }: { onLeave: () => Promise<void>; disabled: boolean }) {
  const [confirm, setConfirm] = useState(false);
  return confirm ? (
    <span className="actions">
      <button
        type="button"
        className="button button--danger"
        disabled={disabled}
        onClick={() => void onLeave()}
      >
        Yes, leave
      </button>
      <button type="button" className="button button--quiet" onClick={() => setConfirm(false)}>
        Cancel
      </button>
    </span>
  ) : (
    <button type="button" className="button button--quiet" onClick={() => setConfirm(true)}>
      Leave plan
    </button>
  );
}
