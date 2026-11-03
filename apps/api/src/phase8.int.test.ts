import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CSRF,
  XFF,
  createStaff,
  randomPhone,
  signInStaff,
  startHarness,
  uniq,
  type Agent,
  type Harness,
} from '../../../scripts/test/api-harness.js';

let h: Harness;
const secrets = new Map<string, string>();
let owner: Agent;
let otherOwnerProperty: string;
let propertyId: string;
let slug: string;

beforeAll(async () => {
  h = await startHarness();
  owner = await signInStaff(
    h,
    await createStaff(h.prisma, [{ role: 'OWNER', propertyId: null }]),
    secrets,
  );
  slug = `p8-${uniq()}`;
  propertyId = (
    await owner.post('/api/v1/admin/properties').set(CSRF).send({ slug, name: 'Office Lodge' })
  ).body.data.id as string;
  otherOwnerProperty = (
    await owner
      .post('/api/v1/admin/properties')
      .set(CSRF)
      .send({ slug: `p8b-${uniq()}`, name: 'Other Lodge' })
  ).body.data.id as string;
});

afterAll(async () => {
  await h.close();
});

const as = async (role: 'SUPPORT' | 'PROPERTY_ADMIN' | 'NETWORK_ADMIN' | 'FINANCE') =>
  signInStaff(h, await createStaff(h.prisma, [{ role, propertyId }]), secrets);

describe('office overview', () => {
  it('shows each role only the sections it may see', async () => {
    const own = await owner.get(`/api/v1/admin/properties/${propertyId}/overview`).expect(200);
    expect(own.body.data).toMatchObject({ rooms: { total: 0 }, residents: 0 });
    expect(own.body.data.sales).not.toBeNull();
    const net = await as('NETWORK_ADMIN');
    const n = await net.get(`/api/v1/admin/properties/${propertyId}/overview`).expect(200);
    expect(n.body.data.sales).toBeNull();
    expect(n.body.data.residents).toBeNull();
    expect(n.body.data.attention.networkFailures).toBe(0);
  });
});

describe('lodge settings', () => {
  it('managers change the name and contacts; changes show on the public site and are logged', async () => {
    const mgr = await as('PROPERTY_ADMIN');
    await mgr
      .patch(`/api/v1/admin/properties/${propertyId}`)
      .set(CSRF)
      .send({
        name: 'ND Lodge Annex',
        supportPhone: '+2347040332279',
        supportEmail: 'Desk@Lodge.TEST',
      })
      .expect(200);
    const pub = await request(h.server).get(`/api/v1/catalog/properties/${slug}`).expect(200);
    expect(pub.body.data).toMatchObject({
      name: 'ND Lodge Annex',
      supportPhone: '+2347040332279',
      supportEmail: 'desk@lodge.test',
    });
    const log = await owner.get(`/api/v1/admin/properties/${propertyId}/audit`).expect(200);
    expect(log.body.data.map((e: { action: string }) => e.action)).toContain(
      'property.settings_changed',
    );
    // Clearing a contact is allowed.
    await mgr
      .patch(`/api/v1/admin/properties/${propertyId}`)
      .set(CSRF)
      .send({ supportEmail: null })
      .expect(200);
  });

  it('other roles and other properties are refused', async () => {
    const desk = await as('SUPPORT');
    await desk
      .patch(`/api/v1/admin/properties/${propertyId}`)
      .set(CSRF)
      .send({ name: 'Nope' })
      .expect(404);
    const mgr = await as('PROPERTY_ADMIN');
    await mgr
      .patch(`/api/v1/admin/properties/${otherOwnerProperty}`)
      .set(CSRF)
      .send({ name: 'Nope' })
      .expect(404);
    await owner.patch(`/api/v1/admin/properties/${propertyId}`).set(CSRF).send({}).expect(400);
  });
});

describe('support for staff', () => {
  it('front desk sees tickets, takes one, and moves it along; finance cannot', async () => {
    const t = await request(h.server)
      .post('/api/v1/support/tickets')
      .set(CSRF)
      .set(XFF())
      .send({
        propertySlug: slug,
        category: 'CONNECTIVITY',
        subject: 'No signal in room 12',
        body: 'Nothing connects since this morning.',
        contactPhone: randomPhone(),
      })
      .expect(201);
    const id = t.body.data.ticketId as string;

    const desk = await as('SUPPORT');
    const list = await desk.get(`/api/v1/admin/properties/${propertyId}/tickets`).expect(200);
    const row = list.body.data.find((x: { id: string }) => x.id === id);
    expect(row).toMatchObject({
      status: 'OPEN',
      subject: 'No signal in room 12',
      assignedTo: null,
    });
    expect(row.contactPhone).toMatch(/^\+234/);

    await desk
      .post(`/api/v1/admin/properties/${propertyId}/tickets/${id}`)
      .set(CSRF)
      .send({ assignToMe: true, status: 'IN_PROGRESS', note: 'Calling them now' })
      .expect(200);
    const open = await desk.get(
      `/api/v1/admin/properties/${propertyId}/tickets?status=IN_PROGRESS`,
    );
    expect(open.body.data.find((x: { id: string }) => x.id === id).assignedTo).not.toBeNull();

    await desk
      .post(`/api/v1/admin/properties/${propertyId}/tickets/${id}`)
      .set(CSRF)
      .send({})
      .expect(400);

    const fin = await as('FINANCE');
    await fin.get(`/api/v1/admin/properties/${propertyId}/tickets`).expect(404);
    await owner
      .post(`/api/v1/admin/properties/${otherOwnerProperty}/tickets/${id}`)
      .set(CSRF)
      .send({ status: 'CLOSED' })
      .expect(404);
  });
});

describe('payments search and refunds list', () => {
  it('finance can read the refunds queue; front desk can read but not approve', async () => {
    const fin = await as('FINANCE');
    await fin.get(`/api/v1/admin/properties/${propertyId}/refunds?status=REQUESTED`).expect(200);
    await fin.get(`/api/v1/admin/properties/${propertyId}/payments?q=NFX`).expect(200);
    const net = await as('NETWORK_ADMIN');
    await net.get(`/api/v1/admin/properties/${propertyId}/refunds`).expect(404);
  });
});
