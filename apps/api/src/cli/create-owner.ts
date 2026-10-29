/**
 * Bootstrap the first platform owner.
 *   echo -n 'a long passphrase' | node --env-file=.env apps/api/dist/cli/create-owner.js --email you@example.com --name "Your Name"
 * The password is read from stdin so it never appears in shell history or process lists.
 * Refuses to run if an active owner already exists (use the break-glass runbook instead).
 */
import { parseArgs } from 'node:util';
import { loadConfig } from '@netflex/config';
import { createPrismaClient, syncRbac } from '@netflex/database';
import { hashPassword, passwordProblems } from '@netflex/security';
import { auditHash } from '../audit/audit.service.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks)
    .toString('utf8')
    .replace(/\r?\n$/, '');
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { email: { type: 'string' }, name: { type: 'string' } },
  });
  const emailAddr = values.email?.trim().toLowerCase();
  const name = values.name?.trim();
  if (!emailAddr || !name)
    throw new Error('usage: --email <email> --name <name>  (password on stdin)');
  const password = await readStdin();
  const problems = passwordProblems(password, [emailAddr, ...name.split(/\s+/)]);
  if (problems.length) throw new Error(`password ${problems.join('; ')}`);

  const config = loadConfig();
  const prisma = createPrismaClient(config.DATABASE_URL);
  try {
    await syncRbac(prisma);
    const passwordHash = await hashPassword(password);
    const id = await prisma.$transaction(async (tx) => {
      const existing = await tx.userRole.count({
        where: { revokedAt: null, propertyId: null, role: { key: 'OWNER' } },
      });
      if (existing > 0) throw new Error('an owner already exists; refusing to create another');
      const role = await tx.role.findUniqueOrThrow({ where: { key: 'OWNER' } });
      const u = await tx.user.create({
        data: {
          kind: 'STAFF',
          email: emailAddr,
          displayName: name,
          passwordHash,
          passwordUpdatedAt: new Date(),
        },
      });
      await tx.userRole.create({ data: { userId: u.id, roleId: role.id, propertyId: null } });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(727274001)`;
      const last = await tx.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { hash: true } });
      const occurredAt = new Date();
      const fields = {
        occurredAt: occurredAt.toISOString(),
        actorType: 'SYSTEM',
        actorUserId: null,
        propertyId: null,
        action: 'staff.owner_bootstrapped',
        targetType: 'user',
        targetId: u.id,
        reason: 'create-owner CLI',
        metadata: {},
      };
      await tx.auditLog.create({
        data: {
          ...fields,
          actorType: 'SYSTEM',
          occurredAt,
          prevHash: last?.hash ?? null,
          hash: auditHash(last?.hash ?? null, fields),
        },
      });
      return u.id;
    });
    process.stdout.write(`owner created: ${id}. Sign in and set up two-step verification.\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`create-owner failed: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
