import { createPrismaClient } from './index.js';
import { syncRbac } from './rbac-sync.js';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const prisma = createPrismaClient(url);
  try {
    const r = await syncRbac(prisma);
    process.stdout.write(`rbac synced: ${r.roles} roles, ${r.permissions} permissions\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`rbac sync failed: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
