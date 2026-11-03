import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  GrantRights,
  MoveRoom,
  RecordDeparture,
  RevokeRights,
} from '@/components/admin/ResidentActions';
import { adminApi, allowed, currentProperty, requireStaff } from '@/lib/admin';
import { propertyStructure, roomOptions, shortDate } from '@/lib/admin-data';

export const metadata = { title: 'Resident' };

interface Tenant {
  id: string;
  displayName: string;
  email: string | null;
  phoneE164: string | null;
  status: string;
  assignments: {
    id: string;
    startsAt: string;
    endsAt: string | null;
    reason: string | null;
    room: { id: string; label: string };
  }[];
  authorities: {
    id: string;
    scope: 'ROOM' | 'FLOOR';
    roomId: string | null;
    floorId: string | null;
    grantedAt: string;
  }[];
}

export default async function ResidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireStaff(`/admin/residents/${id}`);
  const { property } = await currentProperty();
  if (!property || !allowed(me, 'tenant.read', property.id)) redirect('/admin');

  const [t, structure] = await Promise.all([
    adminApi<Tenant>(property.id, `/tenants/${id}`),
    propertyStructure(property.id),
  ]);
  if (!t.data) notFound();
  const r = t.data;
  const canManage = allowed(me, 'tenant.manage', property.id);
  const canGroup = allowed(me, 'group.manage', property.id);

  const floors = structure?.buildings.flatMap((b) => b.floors) ?? [];
  const floorOfRoom = new Map(floors.flatMap((f) => f.rooms.map((x) => [x.id, f])));
  const current = r.assignments.find((a) => !a.endsAt) ?? null;
  const currentFloor = current ? floorOfRoom.get(current.room.id) : undefined;
  const label = (a: Tenant['authorities'][number]) =>
    a.scope === 'ROOM'
      ? `Room ${floors.flatMap((f) => f.rooms).find((x) => x.id === a.roomId)?.label ?? ''}`
      : (floors.find((f) => f.id === a.floorId)?.label ?? 'a floor');

  return (
    <>
      <Link href="/admin/residents" className="adm-back">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M19 12H6M11 6.5 5.5 12 11 17.5" />
        </svg>
        Residents
      </Link>
      <header className="adm-head adm-head--row">
        <div>
          <p className="adm-head__eyebrow">
            {current
              ? `Room ${current.room.label}${currentFloor ? ` · ${currentFloor.label}` : ''}`
              : 'Moved out'}
          </p>
          <h1 className="adm-head__title">{r.displayName}</h1>
          <p className="adm-head__lede">
            {[r.email, r.phoneE164].filter(Boolean).join(' · ') || 'No contact on file'}
          </p>
        </div>
        {canManage && current && structure ? (
          <div className="adm-actions">
            <MoveRoom propertyId={property.id} userId={r.id} groups={roomOptions(structure)} />
            <RecordDeparture
              propertyId={property.id}
              assignmentId={current.id}
              name={r.displayName.split(/\s+/)[0] ?? r.displayName}
            />
          </div>
        ) : null}
      </header>

      <div className="adm-grid">
        <section aria-labelledby="rights-title">
          <h2 id="rights-title" className="adm-h2">
            Buying rights
          </h2>
          <p className="adm-sub">
            Who they can buy room or floor plans for. Personal plans need no rights.
          </p>
          {r.authorities.length ? (
            <ul className="adm-list">
              {r.authorities.map((a) => (
                <li key={a.id}>
                  <span className="adm-list__main">
                    <strong className="adm-plain">{label(a)}</strong>
                    <span>since {shortDate(a.grantedAt)}</span>
                  </span>
                  {canGroup ? (
                    <RevokeRights propertyId={property.id} authorityId={a.id} what={label(a)} />
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="adm-empty">None yet.</p>
          )}
          {canGroup && current && currentFloor ? (
            <div className="adm-after">
              <GrantRights
                propertyId={property.id}
                userId={r.id}
                room={current.room}
                floor={{ id: currentFloor.id, label: currentFloor.label }}
              />
            </div>
          ) : null}
        </section>

        <section aria-labelledby="history-title">
          <h2 id="history-title" className="adm-h2">
            Room history
          </h2>
          <ol className="adm-timeline">
            {r.assignments.map((a) => (
              <li key={a.id} data-current={!a.endsAt}>
                <strong>Room {a.room.label}</strong>
                <span>
                  {shortDate(a.startsAt)} – {a.endsAt ? shortDate(a.endsAt) : 'now'}
                </span>
                {a.reason ? <span className="adm-timeline__note">{a.reason}</span> : null}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </>
  );
}
