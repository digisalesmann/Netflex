#!/usr/bin/env node
// One-time setup of the real lodge (property, building, floors, rooms) on any
// environment. Safe to re-run: skips anything that already exists, never
// deletes or changes existing records. Usage:
//   DATABASE_URL=... node scripts/setup/create-lodge.mjs
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const { createPrismaClient, syncRbac } = require(join(root, 'packages/database/dist/index.js'));

const LODGE = {
  slug: 'nd-lodge',
  name: 'ND Lodge',
  timeZone: 'Africa/Lagos',
  currency: 'NGN',
  supportPhone: '+2347040332279',
  supportEmail: 'networkflex24@gmail.com',
};
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
const FLOORS = [
  { label: 'First floor', level: 1, rooms: range(1, 10) },
  { label: 'Second floor', level: 2, rooms: range(11, 20) },
  { label: 'Third floor', level: 3, rooms: range(21, 31) },
];

const db = createPrismaClient(process.env.DATABASE_URL ?? '');
try {
  await syncRbac(db);
  const property =
    (await db.property.findUnique({ where: { slug: LODGE.slug } })) ??
    (await db.property.create({ data: LODGE }));
  const building =
    (await db.building.findFirst({ where: { propertyId: property.id, name: 'Main' } })) ??
    (await db.building.create({ data: { propertyId: property.id, name: 'Main' } }));
  let created = 0;
  for (const f of FLOORS) {
    const floor =
      (await db.floor.findFirst({ where: { buildingId: building.id, label: f.label } })) ??
      (await db.floor.create({
        data: { propertyId: property.id, buildingId: building.id, label: f.label, level: f.level },
      }));
    for (const label of f.rooms) {
      const exists = await db.room.findFirst({ where: { floorId: floor.id, label } });
      if (!exists) {
        await db.room.create({ data: { propertyId: property.id, floorId: floor.id, label } });
        created++;
      }
    }
  }
  const rooms = await db.room.count({ where: { propertyId: property.id } });
  console.log(
    `${property.name} (${property.slug}): ${FLOORS.length} floors, ${rooms} rooms (${created} new)`,
  );
} finally {
  await db.$disconnect();
}
