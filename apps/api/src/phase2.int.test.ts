import { totpAt } from '@netflex/security';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CSRF,
  PASSWORD,
  XFF,
  createStaff,
  nextTotp,
  randomPhone,
  signInStaff,
  startHarness,
  uniq,
  type Agent,
  type Harness,
} from '../../../scripts/test/api-harness.js';
import { AuditService } from './audit/audit.service.js';
import { OTP_SENDER, type FakeOtpSender } from './auth/otp-sender.js';

let h: Harness;
let otp: FakeOtpSender;
const secrets = new Map<string, string>();

// World: two properties, each with a building/floor/rooms; staff per role.
const P: Record<
  'A' | 'B',
  {
    id: string;
    buildingId: string;
    floor1: string;
    floor2: string;
    room11: string;
    room12: string;
    room21: string;
  }
> = {} as never;
type AgentKey = 'owner' | 'PROPERTY_ADMIN' | 'NETWORK_ADMIN' | 'FINANCE' | 'SUPPORT' | 'adminB';
const agents = {} as Record<AgentKey, Agent>;
let firstAuditId: bigint;

async function buildProperty(owner: Agent, tag: string) {
  const slug = `lodge-${tag.toLowerCase()}-${uniq()}`;
  const p = await owner
    .post('/api/v1/admin/properties')
    .set(CSRF)
    .send({ slug, name: `Lodge ${tag}` });
  expect(p.status).toBe(201);
  const id = p.body.data.id as string;
  const b = await owner
    .post(`/api/v1/admin/properties/${id}/buildings`)
    .set(CSRF)
    .send({ name: 'Block 1' });
  const f1 = await owner
    .post(`/api/v1/admin/properties/${id}/buildings/${b.body.data.id}/floors`)
    .set(CSRF)
    .send({ label: 'Ground', level: 0 });
  const f2 = await owner
    .post(`/api/v1/admin/properties/${id}/buildings/${b.body.data.id}/floors`)
    .set(CSRF)
    .send({ label: 'First', level: 1 });
  const room = async (floorId: string, label: string) =>
    (
      await owner
        .post(`/api/v1/admin/properties/${id}/floors/${floorId}/rooms`)
        .set(CSRF)
        .send({ label })
    ).body.data.id as string;
  return {
    id,
    buildingId: b.body.data.id as string,
    floor1: f1.body.data.id as string,
    floor2: f2.body.data.id as string,
    room11: await room(f1.body.data.id, 'G1'),
    room12: await room(f1.body.data.id, 'G2'),
    room21: await room(f2.body.data.id, 'F1'),
  };
}

beforeAll(async () => {
  h = await startHarness();
  otp = h.app.get(OTP_SENDER);
  firstAuditId =
    BigInt(
      (await h.prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }))?.id ??
        0n,
    ) + 1n;

  const owner = await createStaff(h.prisma, [{ role: 'OWNER', propertyId: null }]);
  agents.owner = await signInStaff(h, owner, secrets);
  P.A = await buildProperty(agents.owner, 'A');
  P.B = await buildProperty(agents.owner, 'B');

  for (const role of ['PROPERTY_ADMIN', 'NETWORK_ADMIN', 'FINANCE', 'SUPPORT'] as const) {
    const s = await createStaff(h.prisma, [{ role, propertyId: P.A.id }]);
    agents[role] = await signInStaff(h, s, secrets);
  }
  const adminB = await createStaff(h.prisma, [{ role: 'PROPERTY_ADMIN', propertyId: P.B.id }]);
  agents.adminB = await signInStaff(h, adminB, secrets);
}, 120_000);

afterAll(async () => {
  await h.close();
});

// ====================================================================== staff sign-in
describe('staff sign-in', () => {
  it('returns the same generic error for a wrong password and an unknown account', async () => {
    const s = await createStaff(h.prisma, [{ role: 'SUPPORT', propertyId: P.A.id }]);
    const wrong = await request(h.server)
      .post('/api/v1/auth/staff/login')
      .set(CSRF)
      .set(XFF())
      .send({ email: s.email, password: 'not-the-password' });
    const unknown = await request(h.server)
      .post('/api/v1/auth/staff/login')
      .set(CSRF)
      .set(XFF())
      .send({ email: `nobody-${uniq()}@test.invalid`, password: 'whatever-123' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
    expect(wrong.body.error.message).toBe('Email or password is incorrect.');
  });

  it('sets a secure session cookie and requires MFA enrollment before anything else', async () => {
    const s = await createStaff(h.prisma, [{ role: 'PROPERTY_ADMIN', propertyId: P.A.id }]);
    const agent = request.agent(h.server);
    const login = await agent
      .post('/api/v1/auth/staff/login')
      .set(CSRF)
      .set(XFF())
      .send({ email: s.email, password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.data.next).toBe('MFA_ENROLL');
    const cookie = String(login.headers['set-cookie']);
    expect(cookie).toMatch(/nf_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);

    const blocked = await agent.get(`/api/v1/admin/properties/${P.A.id}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.details).toEqual({ next: 'MFA_ENROLL' });
    const me = await agent.get('/api/v1/me').expect(200);
    expect(me.body.data.session.mfaSatisfied).toBe(false);

    const enroll = await agent.post('/api/v1/auth/staff/mfa/enroll').set(CSRF).send({});
    expect(enroll.body.data.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    const secret = enroll.body.data.secret as string;
    await agent
      .post('/api/v1/auth/staff/mfa/verify')
      .set(CSRF)
      .send({ code: '000000' })
      .expect(401);
    const code = nextTotp(secret);
    await agent.post('/api/v1/auth/staff/mfa/verify').set(CSRF).send({ code }).expect(200);
    await agent.get(`/api/v1/admin/properties/${P.A.id}`).expect(200);

    // MFA secret is stored encrypted, never in plaintext.
    const row = await h.prisma.user.findUniqueOrThrow({ where: { id: s.id } });
    expect(row.mfaEnabled).toBe(true);
    expect(row.mfaSecretEnc).not.toContain(secret);

    // The same code can't be replayed in a new session.
    const second = request.agent(h.server);
    await second
      .post('/api/v1/auth/staff/login')
      .set(CSRF)
      .set(XFF())
      .send({ email: s.email, password: PASSWORD })
      .expect(200);
    await second.post('/api/v1/auth/staff/mfa/verify').set(CSRF).send({ code }).expect(401);
    // A second enroll attempt is refused once MFA is active.
    await second.post('/api/v1/auth/staff/mfa/enroll').set(CSRF).send({}).expect(409);
  });

  it('forces an initial password change, then revokes other sessions', async () => {
    const s = await createStaff(h.prisma, [{ role: 'SUPPORT', propertyId: P.A.id }], {
      mustChangePassword: true,
    });
    const a1 = await signInStaff(h, s, secrets);
    const blocked = await a1.get(`/api/v1/admin/properties/${P.A.id}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.details).toEqual({ next: 'PASSWORD_CHANGE' });

    const a2 = await signInStaff(h, s, secrets);
    const weak = await a1
      .post('/api/v1/auth/staff/password')
      .set(CSRF)
      .send({ currentPassword: PASSWORD, newPassword: 'short' });
    expect(weak.status).toBe(400);
    await a1
      .post('/api/v1/auth/staff/password')
      .set(CSRF)
      .send({ currentPassword: 'wrong-password-1', newPassword: 'a brand new passphrase 77' })
      .expect(401);
    await a1
      .post('/api/v1/auth/staff/password')
      .set(CSRF)
      .send({ currentPassword: PASSWORD, newPassword: 'a brand new passphrase 77' })
      .expect(200);
    await a1.get(`/api/v1/admin/properties/${P.A.id}`).expect(200);
    await a2.get('/api/v1/me').expect(401);
  });

  it('rate-limits repeated failed sign-ins for one account', async () => {
    const s = await createStaff(h.prisma, [{ role: 'SUPPORT', propertyId: P.A.id }]);
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push(
        (
          await request(h.server)
            .post('/api/v1/auth/staff/login')
            .set(CSRF)
            .set(XFF())
            .set('x-forwarded-for', `10.0.0.${i}`)
            .send({ email: s.email, password: 'wrong-password-x' })
        ).status,
      );
    }
    expect(statuses.slice(0, 10).every((x) => x === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('records failed sign-ins in the audit log without the attempted password', async () => {
    const s = await createStaff(h.prisma, [{ role: 'SUPPORT', propertyId: P.A.id }]);
    await request(h.server)
      .post('/api/v1/auth/staff/login')
      .set(CSRF)
      .set(XFF())
      .send({ email: s.email, password: 'secret-guess-999' })
      .expect(401);
    const entry = await h.prisma.auditLog.findFirst({
      where: { action: 'auth.staff.login_failed', actorUserId: s.id },
    });
    expect(entry).not.toBeNull();
    expect(
      JSON.stringify(entry, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
    ).not.toContain('secret-guess-999');
  });

  it('logout revokes the session', async () => {
    const s = await createStaff(h.prisma, [{ role: 'SUPPORT', propertyId: P.A.id }]);
    const a = await signInStaff(h, s, secrets);
    await a.get('/api/v1/me').expect(200);
    await a.post('/api/v1/auth/logout').set(CSRF).send({}).expect(200);
    await a.get('/api/v1/me').expect(401);
  });

  it('owner credential reset: temporary password, MFA cleared, sessions ended', async () => {
    const s = await createStaff(h.prisma, [{ role: 'SUPPORT', propertyId: P.A.id }]);
    const before = await signInStaff(h, s, secrets);
    await agents.SUPPORT.post(`/api/v1/admin/staff/${s.id}/reset-credentials`)
      .set(CSRF)
      .send({ temporaryPassword: 'temporary passphrase 4521', reason: 'lost phone' })
      .expect(403);
    await agents.owner
      .post(`/api/v1/admin/staff/${s.id}/reset-credentials`)
      .set(CSRF)
      .send({ temporaryPassword: 'temporary passphrase 4521', reason: 'lost phone' })
      .expect(200);
    await before.get('/api/v1/me').expect(401);
    await request(h.server)
      .post('/api/v1/auth/staff/login')
      .set(CSRF)
      .set(XFF())
      .send({ email: s.email, password: PASSWORD })
      .expect(401);
    const after = request.agent(h.server);
    const login = await after
      .post('/api/v1/auth/staff/login')
      .set(CSRF)
      .set(XFF())
      .send({ email: s.email, password: 'temporary passphrase 4521' });
    expect(login.body.data.next).toBe('MFA_ENROLL');
    const me = (await agents.owner.get('/api/v1/me')).body.data.user.id as string;
    await agents.owner
      .post(`/api/v1/admin/staff/${me}/reset-credentials`)
      .set(CSRF)
      .send({ temporaryPassword: 'temporary passphrase 4521', reason: 'self' })
      .expect(403);
  });

  it('disabling an account ends its sessions immediately', async () => {
    const s = await createStaff(h.prisma, [{ role: 'SUPPORT', propertyId: P.A.id }]);
    const a = await signInStaff(h, s, secrets);
    await agents.owner
      .post(`/api/v1/admin/staff/${s.id}/disable`)
      .set(CSRF)
      .send({ reason: 'left the company' })
      .expect(200);
    await a.get('/api/v1/me').expect(401);
    await request(h.server)
      .post('/api/v1/auth/staff/login')
      .set(CSRF)
      .set(XFF())
      .send({ email: s.email, password: PASSWORD })
      .expect(401);
  });
});

// ====================================================================== CSRF
describe('cross-site request protection', () => {
  it('rejects state-changing requests without the verification header', async () => {
    const r = await agents.PROPERTY_ADMIN.post(`/api/v1/admin/properties/${P.A.id}/buildings`).send(
      { name: 'Sneaky' },
    );
    expect(r.status).toBe(403);
  });

  it('rejects requests from a foreign Origin even with the header', async () => {
    const r = await agents.PROPERTY_ADMIN.post(`/api/v1/admin/properties/${P.A.id}/buildings`)
      .set(CSRF)
      .set('origin', 'https://evil.example')
      .send({ name: 'Sneaky' });
    expect(r.status).toBe(403);
  });

  it('protects sign-in too (login CSRF)', async () => {
    await request(h.server)
      .post('/api/v1/auth/staff/login')
      .send({ email: 'a@b.co', password: 'x' })
      .expect(403);
  });

  it('allows the web origin', async () => {
    await agents.PROPERTY_ADMIN.post(`/api/v1/admin/properties/${P.A.id}/buildings`)
      .set(CSRF)
      .set('origin', 'http://localhost:3000')
      .send({ name: `Block ${uniq()}` })
      .expect(201);
  });
});

// ====================================================================== tenant OTP
describe('tenant phone sign-in', () => {
  it('signs in with a valid code, creating a tenant account', async () => {
    const phone = randomPhone();
    const req = await request(h.server)
      .post('/api/v1/auth/tenant/otp/request')
      .set(CSRF)
      .set(XFF())
      .send({ phone });
    expect(req.status).toBe(202);
    const code = otp.lastCode(phone) as string;
    expect(code).toMatch(/^\d{6}$/);
    const agent = request.agent(h.server);
    const v = await agent
      .post('/api/v1/auth/tenant/otp/verify')
      .set(CSRF)
      .set(XFF())
      .send({ phone, code, displayName: 'Ada' });
    expect(v.status).toBe(200);
    const me = await agent.get('/api/v1/me').expect(200);
    expect(me.body.data.user).toMatchObject({
      kind: 'TENANT',
      phoneE164: phone,
      displayName: 'Ada',
    });
    // Codes are single-use.
    await request(h.server)
      .post('/api/v1/auth/tenant/otp/verify')
      .set(CSRF)
      .set(XFF())
      .send({ phone, code })
      .expect(401);
    // Codes are stored only as keyed verifiers.
    const stored = await h.prisma.otpChallenge.findFirst({ where: { phoneE164: phone } });
    expect(stored?.codeVerifier).not.toContain(code);
  });

  it('accepts local Nigerian number formats', async () => {
    const local = `081${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    await request(h.server)
      .post('/api/v1/auth/tenant/otp/request')
      .set(CSRF)
      .set(XFF())
      .send({ phone: local })
      .expect(202);
    expect(otp.lastCode(`+234${local.slice(1)}`)).toBeDefined();
  });

  it('locks a code after 5 wrong attempts, even if the right code follows', async () => {
    const phone = randomPhone();
    await request(h.server)
      .post('/api/v1/auth/tenant/otp/request')
      .set(CSRF)
      .set(XFF())
      .send({ phone })
      .expect(202);
    const code = otp.lastCode(phone) as string;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++)
      await request(h.server)
        .post('/api/v1/auth/tenant/otp/verify')
        .set(CSRF)
        .set(XFF())
        .send({ phone, code: wrong })
        .expect(401);
    await request(h.server)
      .post('/api/v1/auth/tenant/otp/verify')
      .set(CSRF)
      .set(XFF())
      .send({ phone, code })
      .expect(401);
  });

  it('never sends tenant codes to a staff phone number (but answers identically)', async () => {
    const phone = randomPhone();
    const s = await createStaff(h.prisma, [{ role: 'SUPPORT', propertyId: P.A.id }]);
    await h.prisma.user.update({ where: { id: s.id }, data: { phoneE164: phone } });
    const r = await request(h.server)
      .post('/api/v1/auth/tenant/otp/request')
      .set(CSRF)
      .set(XFF())
      .send({ phone });
    expect(r.status).toBe(202);
    expect(r.body.data.message).toBe('If this number can sign in, a code is on its way.');
    expect(otp.count(phone)).toBe(0);
  });

  it('limits code requests per phone number', async () => {
    const phone = randomPhone();
    for (let i = 0; i < 3; i++)
      await request(h.server)
        .post('/api/v1/auth/tenant/otp/request')
        .set(CSRF)
        .set(XFF())
        .set('x-forwarded-for', `10.1.0.${i}`)
        .send({ phone })
        .expect(202);
    await request(h.server)
      .post('/api/v1/auth/tenant/otp/request')
      .set(CSRF)
      .set(XFF())
      .send({ phone })
      .expect(429);
  });

  it('tenants cannot reach any admin endpoint', async () => {
    const phone = randomPhone();
    await request(h.server)
      .post('/api/v1/auth/tenant/otp/request')
      .set(CSRF)
      .set(XFF())
      .send({ phone });
    const t = request.agent(h.server);
    await t
      .post('/api/v1/auth/tenant/otp/verify')
      .set(CSRF)
      .set(XFF())
      .send({ phone, code: otp.lastCode(phone) })
      .expect(200);
    await t.get('/api/v1/admin/properties').expect(403);
    await t.get(`/api/v1/admin/properties/${P.A.id}`).expect(403);
    await t.get('/api/v1/admin/staff').expect(403);
    await t.post('/api/v1/auth/staff/mfa/enroll').set(CSRF).send({}).expect(403);
  });

  it('is unavailable (503) when no SMS provider is configured', async () => {
    const plain = await startHarness({ OTP_PROVIDER: 'none' });
    try {
      const r = await request(plain.server)
        .post('/api/v1/auth/tenant/otp/request')
        .set(CSRF)
        .set(XFF())
        .send({ phone: randomPhone() });
      expect(r.status).toBe(503);
    } finally {
      await plain.close();
    }
  });
});

// ====================================================================== RBAC matrix
describe('role permission matrix on property A', () => {
  type Row = [
    label: string,
    method: 'get' | 'post',
    path: (id: string) => string,
    body: Record<string, unknown> | undefined,
    allowed: AgentKey[],
  ];
  const rows: Row[] = [
    [
      'view structure',
      'get',
      (id) => `/api/v1/admin/properties/${id}`,
      undefined,
      ['PROPERTY_ADMIN', 'NETWORK_ADMIN', 'FINANCE', 'SUPPORT'],
    ],
    [
      'add building',
      'post',
      (id) => `/api/v1/admin/properties/${id}/buildings`,
      { name: `M-${uniq()}` },
      ['PROPERTY_ADMIN'],
    ],
    [
      'list tenants',
      'get',
      (id) => `/api/v1/admin/properties/${id}/tenants`,
      undefined,
      ['PROPERTY_ADMIN', 'SUPPORT'],
    ],
    [
      'view audit',
      'get',
      (id) => `/api/v1/admin/properties/${id}/audit`,
      undefined,
      ['PROPERTY_ADMIN'],
    ],
  ];
  const roles: AgentKey[] = ['PROPERTY_ADMIN', 'NETWORK_ADMIN', 'FINANCE', 'SUPPORT'];

  for (const [label, method, path, body, allowed] of rows) {
    for (const role of roles) {
      const ok = allowed.includes(role);
      it(`${role} ${ok ? 'can' : 'cannot'} ${label}`, async () => {
        const call = agents[role]?.[method](path(P.A.id)).set(CSRF);
        const r = await (body ? call?.send({ ...body, name: `M-${uniq()}` }) : call);
        // Denied property-scoped routes answer 404 so they don't confirm the resource exists.
        expect(r?.status).toBe(ok ? (method === 'post' ? 201 : 200) : 404);
      });
    }
  }

  it.each<AgentKey>(['PROPERTY_ADMIN', 'NETWORK_ADMIN', 'FINANCE', 'SUPPORT'])(
    '%s cannot create properties or staff',
    async (role) => {
      await agents[role]
        ?.post('/api/v1/admin/properties')
        .set(CSRF)
        .send({ slug: `x-${uniq()}`, name: 'Nope' })
        .expect(403);
      await agents[role]
        ?.post('/api/v1/admin/staff')
        .set(CSRF)
        .send({
          email: `x-${uniq()}@t.invalid`,
          displayName: 'X Y',
          initialPassword: 'a long enough passphrase',
        })
        .expect(403);
    },
  );
});

// ====================================================================== cross-property isolation
describe('cross-property isolation', () => {
  it('lists only properties the actor can read', async () => {
    const r = await agents.PROPERTY_ADMIN.get('/api/v1/admin/properties').expect(200);
    const ids = (r.body.data as { id: string }[]).map((p) => p.id);
    expect(ids).toContain(P.A.id);
    expect(ids).not.toContain(P.B.id);
  });

  it('every property-scoped route for B answers 404 to an admin of A', async () => {
    const a = agents.PROPERTY_ADMIN;
    await a.get(`/api/v1/admin/properties/${P.B.id}`).expect(404);
    await a.get(`/api/v1/admin/properties/${P.B.id}/tenants`).expect(404);
    await a.get(`/api/v1/admin/properties/${P.B.id}/audit`).expect(404);
    await a
      .post(`/api/v1/admin/properties/${P.B.id}/buildings`)
      .set(CSRF)
      .send({ name: 'X' })
      .expect(404);
  });

  it('IDs from property B are not reachable through property A routes (IDOR)', async () => {
    const a = agents.PROPERTY_ADMIN;
    await a
      .patch(`/api/v1/admin/properties/${P.A.id}/rooms/${P.B.room11}`)
      .set(CSRF)
      .send({ label: 'hijack' })
      .expect(404);
    await a
      .post(`/api/v1/admin/properties/${P.A.id}/floors/${P.B.floor1}/rooms`)
      .set(CSRF)
      .send({ label: 'X1' })
      .expect(404);
    await a
      .post(`/api/v1/admin/properties/${P.A.id}/buildings/${P.B.buildingId}/floors`)
      .set(CSRF)
      .send({ label: 'X', level: 9 })
      .expect(404);
    await a
      .post(`/api/v1/admin/properties/${P.A.id}/tenants`)
      .set(CSRF)
      .send({
        phone: randomPhone(),
        displayName: 'X',
        roomId: P.B.room11,
        startsAt: new Date().toISOString(),
      })
      .expect(404);

    // A tenant who only lives in B is invisible to A.
    const onboardB = await agents.adminB
      .post(`/api/v1/admin/properties/${P.B.id}/tenants`)
      .set(CSRF)
      .send({
        phone: randomPhone(),
        displayName: 'Only B',
        roomId: P.B.room11,
        startsAt: '2026-01-01T00:00:00Z',
      });
    expect(onboardB.status).toBe(201);
    const bTenant = onboardB.body.data.userId as string;
    await a.get(`/api/v1/admin/properties/${P.A.id}/tenants/${bTenant}`).expect(404);
    await a
      .post(`/api/v1/admin/properties/${P.A.id}/assignments`)
      .set(CSRF)
      .send({
        userId: bTenant,
        roomId: P.A.room11,
        startsAt: new Date().toISOString(),
        reason: 'pull into A',
      })
      .expect(404);
    const bAssignment = await h.prisma.tenantAssignment.findFirstOrThrow({
      where: { userId: bTenant },
    });
    await a
      .post(`/api/v1/admin/properties/${P.A.id}/assignments/${bAssignment.id}/end`)
      .set(CSRF)
      .send({ endsAt: new Date().toISOString(), reason: 'evict' })
      .expect(404);
  });

  it('the same person can be a tenant in two properties without either admin seeing the other history', async () => {
    const phone = randomPhone();
    const inA = await agents.PROPERTY_ADMIN.post(`/api/v1/admin/properties/${P.A.id}/tenants`)
      .set(CSRF)
      .send({
        phone,
        displayName: 'Two Homes',
        roomId: P.A.room12,
        startsAt: '2026-02-01T00:00:00Z',
      });
    const inB = await agents.adminB
      .post(`/api/v1/admin/properties/${P.B.id}/tenants`)
      .set(CSRF)
      .send({
        phone,
        displayName: 'Two Homes',
        roomId: P.B.room12,
        startsAt: '2026-02-01T00:00:00Z',
      });
    expect(inB.body.data.userId).toBe(inA.body.data.userId);
    expect(inB.body.data.createdAccount).toBe(false);
    const viewA = await agents.PROPERTY_ADMIN.get(
      `/api/v1/admin/properties/${P.A.id}/tenants/${inA.body.data.userId}`,
    ).expect(200);
    expect(viewA.body.data.assignments).toHaveLength(1);
    expect(viewA.body.data.assignments[0].room.id).toBe(P.A.room12);
  });
});

// ====================================================================== privilege escalation
describe('privilege escalation', () => {
  it('a property admin cannot grant roles, including to themselves', async () => {
    const me = (await agents.PROPERTY_ADMIN.get('/api/v1/me')).body.data.user.id as string;
    await agents.PROPERTY_ADMIN.post(`/api/v1/admin/staff/${me}/roles`)
      .set(CSRF)
      .send({ role: 'PROPERTY_ADMIN', propertyId: P.B.id, reason: 'expand' })
      .expect(403);
    await agents.PROPERTY_ADMIN.post(`/api/v1/admin/staff/${me}/roles`)
      .set(CSRF)
      .send({ role: 'OWNER', propertyId: null, reason: 'expand' })
      .expect(403);
  });

  it('the owner can grant a property role, and the database refuses a platform-wide non-owner role', async () => {
    const s = await createStaff(h.prisma, []);
    const g = await agents.owner
      .post(`/api/v1/admin/staff/${s.id}/roles`)
      .set(CSRF)
      .send({ role: 'FINANCE', propertyId: P.A.id, reason: 'new hire' });
    expect(g.status).toBe(201);
    await agents.owner
      .post(`/api/v1/admin/staff/${s.id}/roles`)
      .set(CSRF)
      .send({ role: 'FINANCE', propertyId: null, reason: 'wide' })
      .expect(403);
    const finance = await h.prisma.role.findUniqueOrThrow({ where: { key: 'FINANCE' } });
    await expect(
      h.prisma.userRole.create({ data: { userId: s.id, roleId: finance.id, propertyId: null } }),
    ).rejects.toThrow(/must be granted on a property/);
  });

  it('owners cannot disable themselves', async () => {
    const me = (await agents.owner.get('/api/v1/me')).body.data.user.id as string;
    await agents.owner
      .post(`/api/v1/admin/staff/${me}/disable`)
      .set(CSRF)
      .send({ reason: 'oops' })
      .expect(403);
  });

  it('the last active owner cannot have the owner role revoked', async () => {
    const me = (await agents.owner.get('/api/v1/me')).body.data;
    const grantId = (
      await h.prisma.userRole.findFirstOrThrow({ where: { userId: me.user.id, revokedAt: null } })
    ).id;
    const r = await agents.owner
      .post(`/api/v1/admin/staff/${me.user.id}/roles/${grantId}/revoke`)
      .set(CSRF)
      .send({ reason: 'test' });
    expect(r.status).toBe(409);
  });

  it('staff list is limited to the viewer’s properties', async () => {
    const r = await agents.PROPERTY_ADMIN.get('/api/v1/admin/staff').expect(200);
    const props = new Set(
      (r.body.data as { grants: { propertyId: string | null }[] }[]).flatMap((u) =>
        u.grants.map((g) => g.propertyId),
      ),
    );
    expect([...props]).toEqual([P.A.id]);
    await agents.FINANCE.get('/api/v1/admin/staff').expect(403);
  });
});

// ====================================================================== tenancy lifecycle
describe('tenancy lifecycle', () => {
  it('onboard → room authority → move floors (authority auto-revoked) → depart', async () => {
    const a = agents.PROPERTY_ADMIN;
    const base = `/api/v1/admin/properties/${P.A.id}`;
    const on = await a.post(`${base}/tenants`).set(CSRF).send({
      phone: randomPhone(),
      displayName: 'Mover',
      roomId: P.A.room11,
      startsAt: '2026-03-01T00:00:00Z',
    });
    expect(on.status).toBe(201);
    const userId = on.body.data.userId as string;

    // Floor authority requires living on that floor.
    await a
      .post(`${base}/group-authorities`)
      .set(CSRF)
      .send({ userId, scope: 'FLOOR', targetId: P.A.floor2, reason: 'floor rep' })
      .expect(422);
    const grant = await a
      .post(`${base}/group-authorities`)
      .set(CSRF)
      .send({ userId, scope: 'ROOM', targetId: P.A.room11, reason: 'room rep' });
    expect(grant.status).toBe(201);
    await a
      .post(`${base}/group-authorities`)
      .set(CSRF)
      .send({ userId, scope: 'ROOM', targetId: P.A.room11, reason: 'again' })
      .expect(409);
    const floorGrant = await a
      .post(`${base}/group-authorities`)
      .set(CSRF)
      .send({ userId, scope: 'FLOOR', targetId: P.A.floor1, reason: 'floor rep' });
    expect(floorGrant.status).toBe(201);

    // Same-floor move keeps floor authority, drops room authority.
    await a
      .post(`${base}/assignments`)
      .set(CSRF)
      .send({ userId, roomId: P.A.room12, startsAt: '2026-04-01T00:00:00Z', reason: 'swap' })
      .expect(201);
    let t = await a.get(`${base}/tenants/${userId}`).expect(200);
    expect((t.body.data.authorities as { scope: string }[]).map((x) => x.scope)).toEqual(['FLOOR']);

    // Move to another floor: floor authority dropped too.
    await a
      .post(`${base}/assignments`)
      .set(CSRF)
      .send({ userId, roomId: P.A.room21, startsAt: '2026-05-01T00:00:00Z', reason: 'upstairs' })
      .expect(201);
    t = await a.get(`${base}/tenants/${userId}`).expect(200);
    expect(t.body.data.authorities).toEqual([]);
    expect(t.body.data.assignments).toHaveLength(3);
    expect(
      t.body.data.assignments.filter((x: { endsAt: string | null }) => x.endsAt === null),
    ).toHaveLength(1);

    // Backdated moves are rejected.
    await a
      .post(`${base}/assignments`)
      .set(CSRF)
      .send({ userId, roomId: P.A.room11, startsAt: '2026-04-15T00:00:00Z', reason: 'backdate' })
      .expect(422);

    const open = (t.body.data.assignments as { id: string; endsAt: string | null }[]).find(
      (x) => x.endsAt === null,
    ) as { id: string };
    await a
      .post(`${base}/assignments/${open.id}/end`)
      .set(CSRF)
      .send({ endsAt: '2026-06-01T00:00:00Z', reason: 'moved out' })
      .expect(200);
    await a
      .post(`${base}/assignments/${open.id}/end`)
      .set(CSRF)
      .send({ endsAt: '2026-06-02T00:00:00Z', reason: 'again' })
      .expect(409);

    const actions = (
      await h.prisma.auditLog.findMany({
        where: { propertyId: P.A.id, metadata: { path: ['userId'], equals: userId } },
        select: { action: true },
      })
    ).map((x) => x.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'tenant.assigned',
        'group_authority.granted',
        'tenant.moved',
        'group_authority.revoked',
        'tenant.departed',
      ]),
    );
  });

  it('rejects unknown fields (mass assignment) and invalid input with field paths only', async () => {
    const r = await agents.PROPERTY_ADMIN.post(`/api/v1/admin/properties/${P.A.id}/buildings`)
      .set(CSRF)
      .send({ name: 'Ok', propertyId: P.B.id });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
    const bad = await agents.PROPERTY_ADMIN.post(`/api/v1/admin/properties/${P.A.id}/tenants`)
      .set(CSRF)
      .send({ phone: 'not-a-phone', displayName: '', roomId: 'x', startsAt: 'never' });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).not.toContain('not-a-phone');
  });
});

// ====================================================================== audit
describe('audit log', () => {
  it('records mutations with actor, property and request id', async () => {
    const r = await agents.PROPERTY_ADMIN.post(`/api/v1/admin/properties/${P.A.id}/buildings`)
      .set(CSRF)
      .set('x-request-id', `audit-check-${uniq()}`)
      .send({ name: `Audit ${uniq()}` });
    const entry = await h.prisma.auditLog.findFirstOrThrow({
      where: { action: 'building.created', targetId: r.body.data.id },
    });
    expect(entry.propertyId).toBe(P.A.id);
    expect(entry.correlationId).toBe(r.headers['x-request-id']);
    expect(entry.actorUserId).not.toBeNull();
  });

  it('the property audit view only shows that property', async () => {
    const r = await agents.PROPERTY_ADMIN.get(
      `/api/v1/admin/properties/${P.A.id}/audit?limit=200`,
    ).expect(200);
    expect((r.body.data as { propertyId: string }[]).every((e) => e.propertyId === P.A.id)).toBe(
      true,
    );
  });

  it('the hash chain verifies for everything written in this run', async () => {
    const audit = h.app.get(AuditService);
    expect(await audit.verifyChain(firstAuditId)).toBeNull();
  });

  it('TOTP helper sanity: codes differ across steps', () => {
    expect(totpAt('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 0)).not.toBe(
      totpAt('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 30),
    );
  });
});
