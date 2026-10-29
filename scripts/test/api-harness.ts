import type { NestExpressApplication } from '@nestjs/platform-express';
import { createPrismaClient, type PrismaClient } from '@netflex/database';
import type { RoleKey } from '@netflex/domain';
import { hashPassword, totpAt } from '@netflex/security';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../../apps/api/src/app.factory.js';
import { testConfig } from './test-config.js';

export const CSRF = { 'x-netflex-csrf': '1' } as const;
export const PASSWORD = 'integration-test-passphrase-01';

export type Agent = ReturnType<typeof request.agent>;

export interface Harness {
  app: NestExpressApplication;
  prisma: PrismaClient;
  server: Parameters<typeof request>[0];
  close(): Promise<void>;
}

export async function startHarness(overrides: Record<string, string> = {}): Promise<Harness> {
  const config = testConfig({ OTP_PROVIDER: 'fake', ...overrides });
  const app = await createApp(config);
  await app.init();
  const prisma = createPrismaClient(config.DATABASE_URL);
  return {
    app,
    prisma,
    server: app.getHttpServer() as Parameters<typeof request>[0],
    async close() {
      await prisma.$disconnect();
      await app.close();
    },
  };
}

export const uniq = () => randomBytes(4).toString('hex');
/** Distinct client address per call (honoured because tests run with TRUST_PROXY=loopback). */
export const XFF = () => ({
  'x-forwarded-for': `10.${[0, 0, 0].map(() => randomBytes(1)[0]).join('.')}`,
});
export const randomPhone = () =>
  `+23481${String(randomBytes(4).readUInt32BE(0) % 100_000_000).padStart(8, '0')}`;

let cachedHash: Promise<string> | undefined;
/** Low-cost hash for fixtures (production uses the default cost). */
const fixtureHash = () => (cachedHash ??= hashPassword(PASSWORD, { logN: 12 }));

/** Create a staff user directly in the database with the given grants. */
export async function createStaff(
  prisma: PrismaClient,
  grants: { role: RoleKey; propertyId: string | null }[],
  opts: { mustChangePassword?: boolean } = {},
): Promise<{ id: string; email: string }> {
  const email = `staff-${uniq()}@test.invalid`;
  const user = await prisma.user.create({
    data: {
      kind: 'STAFF',
      email,
      displayName: `Staff ${uniq()}`,
      passwordHash: await fixtureHash(),
      mustChangePassword: opts.mustChangePassword ?? false,
    },
  });
  for (const g of grants) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: g.role } });
    await prisma.userRole.create({
      data: { userId: user.id, roleId: role.id, propertyId: g.propertyId },
    });
  }
  return { id: user.id, email };
}

const lastStep = new Map<string, number>();
/** A TOTP code for a step not yet used by this secret (replay protection allows each step once). */
export function nextTotp(secret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const current = Math.floor(now / 30);
  const step = Math.max(current - 1, (lastStep.get(secret) ?? current - 2) + 1);
  if (step > current + 1) throw new Error('no unused TOTP step available; wait 30s');
  lastStep.set(secret, step);
  return totpAt(secret, step * 30);
}

/** Sign a staff member in through the real API, enrolling MFA on first use. Returns an agent with the session cookie. */
export async function signInStaff(
  h: Harness,
  user: { email: string },
  secrets: Map<string, string>,
): Promise<Agent> {
  const agent = request.agent(h.server);
  const login = await agent
    .post('/api/v1/auth/staff/login')
    .set(CSRF)
    .set(XFF())
    .send({ email: user.email, password: PASSWORD });
  if (login.status !== 200)
    throw new Error(`login failed: ${login.status} ${JSON.stringify(login.body)}`);
  let secret = secrets.get(user.email);
  if (login.body.data.next === 'MFA_ENROLL') {
    const enroll = await agent.post('/api/v1/auth/staff/mfa/enroll').set(CSRF).send({});
    secret = enroll.body.data.secret as string;
    secrets.set(user.email, secret);
  }
  if (!secret) throw new Error('no MFA secret known for this user');
  const verify = await agent
    .post('/api/v1/auth/staff/mfa/verify')
    .set(CSRF)
    .send({ code: nextTotp(secret) });
  if (verify.status !== 200)
    throw new Error(`mfa failed: ${verify.status} ${JSON.stringify(verify.body)}`);
  return agent;
}
