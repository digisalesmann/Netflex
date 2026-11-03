'use client';

import { useRouter } from 'next/navigation';
import { Select } from '../Select';
import { api } from '@/lib/api';
import { ActionForm, Field, Panel, lagosDayStart, todayLagos } from './kit';

export interface RoomGroup {
  group: string;
  floorId: string;
  rooms: { id: string; label: string }[];
}

const base = (p: string) => `/admin/properties/${p}`;
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

function RoomSelect({ groups, name = 'roomId' }: { groups: RoomGroup[]; name?: string }) {
  return (
    <Select
      name={name}
      required
      placeholder="Choose a room"
      groups={groups.map((g) => ({
        label: g.group,
        options: g.rooms.map((r) => ({ value: r.id, label: `Room ${r.label}` })),
      }))}
    />
  );
}

/** The chosen room, or a plain message when none was picked. */
function roomOf(f: FormData): string {
  const v = String(f.get('roomId') ?? '');
  if (!v) throw new Error('Choose a room.');
  return v;
}

export function AddResident({ propertyId, groups }: { propertyId: string; groups: RoomGroup[] }) {
  const router = useRouter();
  return (
    <Panel
      label="Add resident"
      title="Add a resident"
      lede="They’ll sign in with this email: no password, we send them a code."
    >
      {(close) => (
        <ActionForm
          cta="Add resident"
          done={(r) => {
            close();
            const id = (r as { userId?: string } | null)?.userId;
            if (id) router.push(`/admin/residents/${id}`);
          }}
          submit={(f) =>
            api(`${base(propertyId)}/tenants`, {
              method: 'POST',
              body: {
                displayName: str(f, 'name'),
                email: str(f, 'email').toLowerCase(),
                ...(str(f, 'phone') ? { phone: str(f, 'phone') } : {}),
                roomId: roomOf(f),
                startsAt: lagosDayStart(str(f, 'startsAt')),
                ...(str(f, 'reason') ? { reason: str(f, 'reason') } : {}),
              },
            })
          }
        >
          <Field label="Full name">
            <input name="name" required maxLength={120} autoComplete="off" />
          </Field>
          <Field label="Email">
            <input
              name="email"
              type="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              autoComplete="off"
            />
          </Field>
          <Field label="Phone (optional)" hint="For the office to call. e.g. 0803 000 0000">
            <input name="phone" type="tel" inputMode="tel" autoComplete="off" />
          </Field>
          <Field label="Room">
            <RoomSelect groups={groups} />
          </Field>
          <Field label="Moved in on">
            <input name="startsAt" type="date" required defaultValue={todayLagos()} />
          </Field>
          <Field label="Note (optional)" hint="Saved in the activity log, e.g. new lease.">
            <input name="reason" maxLength={500} autoComplete="off" />
          </Field>
        </ActionForm>
      )}
    </Panel>
  );
}

export function MoveRoom({
  propertyId,
  userId,
  groups,
}: {
  propertyId: string;
  userId: string;
  groups: RoomGroup[];
}) {
  return (
    <Panel label="Move room" title="Move to another room" tone="quiet">
      {(close) => (
        <ActionForm
          cta="Move"
          done={close}
          submit={(f) =>
            api(`${base(propertyId)}/assignments`, {
              method: 'POST',
              body: {
                userId,
                roomId: roomOf(f),
                startsAt: lagosDayStart(str(f, 'startsAt')),
                reason: str(f, 'reason'),
              },
            })
          }
        >
          <Field label="New room">
            <RoomSelect groups={groups} />
          </Field>
          <Field label="Moving on">
            <input name="startsAt" type="date" required defaultValue={todayLagos()} />
          </Field>
          <Field label="Reason" hint="Saved in the activity log.">
            <input name="reason" required minLength={3} maxLength={500} autoComplete="off" />
          </Field>
        </ActionForm>
      )}
    </Panel>
  );
}

export function RecordDeparture({
  propertyId,
  assignmentId,
  name,
}: {
  propertyId: string;
  assignmentId: string;
  name: string;
}) {
  return (
    <Panel
      label="Record move-out"
      title={`${name} is moving out`}
      lede="Their room and floor purchase rights end on this date. Plans they already bought keep running."
      tone="danger"
    >
      {(close) => (
        <ActionForm
          cta="Record move-out"
          tone="danger"
          done={close}
          submit={(f) =>
            api(`${base(propertyId)}/assignments/${assignmentId}/end`, {
              method: 'POST',
              body: { endsAt: lagosDayStart(str(f, 'endsAt')), reason: str(f, 'reason') },
            })
          }
        >
          <Field label="Last day">
            <input name="endsAt" type="date" required defaultValue={todayLagos()} />
          </Field>
          <Field label="Reason" hint="Saved in the activity log.">
            <input name="reason" required minLength={3} maxLength={500} autoComplete="off" />
          </Field>
        </ActionForm>
      )}
    </Panel>
  );
}

export function GrantRights({
  propertyId,
  userId,
  room,
  floor,
}: {
  propertyId: string;
  userId: string;
  room: { id: string; label: string };
  floor: { id: string; label: string };
}) {
  return (
    <Panel
      label="Give buying rights"
      title="Let them buy for others"
      lede="Room and floor plans can only be bought by residents you allow here."
      tone="quiet"
    >
      {(close) => (
        <ActionForm
          cta="Give rights"
          done={close}
          submit={(f) => {
            const scope = str(f, 'scope') as 'ROOM' | 'FLOOR';
            return api(`${base(propertyId)}/group-authorities`, {
              method: 'POST',
              body: {
                userId,
                scope,
                targetId: scope === 'ROOM' ? room.id : floor.id,
                reason: str(f, 'reason'),
              },
            });
          }}
        >
          <fieldset className="adm-choice">
            <legend className="adm-field__label">Can buy plans for</legend>
            <label>
              <input type="radio" name="scope" value="ROOM" defaultChecked /> Room {room.label}
            </label>
            <label>
              <input type="radio" name="scope" value="FLOOR" /> The whole {floor.label}
            </label>
          </fieldset>
          <Field label="Reason" hint="Saved in the activity log.">
            <input name="reason" required minLength={3} maxLength={500} autoComplete="off" />
          </Field>
        </ActionForm>
      )}
    </Panel>
  );
}

export function RevokeRights({
  propertyId,
  authorityId,
  what,
}: {
  propertyId: string;
  authorityId: string;
  what: string;
}) {
  return (
    <Panel label="Remove" title={`Remove buying rights for ${what}`} tone="quiet">
      {(close) => (
        <ActionForm
          cta="Remove rights"
          tone="danger"
          done={close}
          submit={(f) =>
            api(`${base(propertyId)}/group-authorities/${authorityId}/revoke`, {
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
