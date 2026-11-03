import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AddFloor, AddRooms } from '@/components/admin/RoomActions';
import { allowed, currentProperty, requireStaff } from '@/lib/admin';
import { allTenants, propertyStructure, type TenantRow } from '@/lib/admin-data';

export const metadata = { title: 'Rooms' };

export default async function RoomsPage() {
  const me = await requireStaff('/admin/rooms');
  const { property } = await currentProperty();
  if (!property || !allowed(me, 'property.read', property.id)) redirect('/admin');
  const canManage = allowed(me, 'property.manage', property.id);
  const canSeeTenants = allowed(me, 'tenant.read', property.id);

  const [structure, tenants] = await Promise.all([
    propertyStructure(property.id),
    canSeeTenants ? allTenants(property.id) : Promise.resolve([] as TenantRow[]),
  ]);
  if (!structure)
    return <p className="adm-empty">Rooms couldn&apos;t load. Refresh to try again.</p>;

  const byRoom = new Map<string, TenantRow[]>();
  for (const t of tenants) {
    const id = t.currentAssignment?.room.id;
    if (id) byRoom.set(id, [...(byRoom.get(id) ?? []), t]);
  }
  const floors = structure.buildings.flatMap((b) => b.floors.map((f) => ({ ...f, building: b })));
  const total = floors.reduce((n, f) => n + f.rooms.length, 0);
  const occupied = floors.reduce((n, f) => n + f.rooms.filter((r) => byRoom.has(r.id)).length, 0);
  const main = structure.buildings[0];

  return (
    <>
      <header className="adm-head adm-head--row">
        <div>
          <p className="adm-head__eyebrow">{property.name}</p>
          <h1 className="adm-head__title">Rooms</h1>
          <p className="adm-head__lede">
            {total} rooms on {floors.length} {floors.length === 1 ? 'floor' : 'floors'}
            {canSeeTenants ? ` · ${occupied} occupied` : ''}
          </p>
        </div>
        {canManage && main ? (
          <AddFloor
            propertyId={property.id}
            buildingId={main.id}
            nextLevel={Math.max(0, ...main.floors.map((f) => f.level)) + 1}
          />
        ) : null}
      </header>

      {floors.map((f) => {
        const used = f.rooms.filter((r) => byRoom.has(r.id)).length;
        return (
          <section key={f.id} className="adm-floor" aria-labelledby={`f-${f.id}`}>
            <div className="adm-floor__head">
              <h2 id={`f-${f.id}`} className="adm-h2">
                {structure.buildings.length > 1 ? `${f.building.name} · ` : ''}
                {f.label}
              </h2>
              <span className="adm-floor__count">
                {canSeeTenants
                  ? `${used} of ${f.rooms.length} occupied`
                  : `${f.rooms.length} rooms`}
              </span>
              {canManage ? (
                <AddRooms propertyId={property.id} floorId={f.id} floorLabel={f.label} />
              ) : null}
            </div>
            {f.rooms.length ? (
              <ul className="adm-rooms">
                {f.rooms.map((r) => {
                  const people = byRoom.get(r.id) ?? [];
                  return (
                    <li key={r.id} className="adm-room" data-occupied={people.length > 0}>
                      <span className="adm-room__label">
                        <span className="adm-sr">Room </span>
                        {r.label}
                      </span>
                      {canSeeTenants ? (
                        people.length ? (
                          <span className="adm-room__people">
                            {people.map((p) => (
                              <Link key={p.id} href={`/admin/residents/${p.id}`}>
                                {p.displayName}
                              </Link>
                            ))}
                          </span>
                        ) : (
                          <span className="adm-room__empty">Empty</span>
                        )
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="adm-empty">No rooms on this floor yet.</p>
            )}
          </section>
        );
      })}
    </>
  );
}
