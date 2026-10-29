import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { createPrismaClient, syncRbac } from '@netflex/database';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    testDatabaseUrl: string;
  }
}

/**
 * Each integration run gets its own PostgreSQL schema inside the netflex_test
 * database: migrations are applied from scratch (proving they build a database
 * from zero), tests see no leftovers from earlier runs, and the schema is dropped
 * afterwards. Refuses to touch any database not named netflex_test.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const base =
    process.env.TEST_DATABASE_URL ??
    'postgresql://netflex:netflex-dev-only@localhost:54329/netflex_test';
  const u = new URL(base);
  if (u.pathname !== '/netflex_test')
    throw new Error('TEST_DATABASE_URL must point at a database named netflex_test');
  const schema = `t_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
  u.searchParams.set('schema', schema);
  const url = u.toString();

  try {
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: resolve(import.meta.dirname, '../../packages/database'),
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
      encoding: 'utf8',
    });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    throw new Error(
      `prisma migrate deploy failed on the test schema:\n${err.stdout ?? ''}\n${err.stderr ?? ''}`,
    );
  }
  const prisma = createPrismaClient(url);
  await syncRbac(prisma);
  project.provide('testDatabaseUrl', url);

  return async () => {
    if (process.env.KEEP_TEST_SCHEMA !== '1' && /^t_[a-z0-9]+_[0-9a-f]{6}$/.test(schema)) {
      await prisma.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    }
    await prisma.$disconnect();
  };
}
