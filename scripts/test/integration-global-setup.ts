import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Applies migrations to the dedicated test database before integration tests.
 * Refuses to run against anything that doesn't look like a test database.
 */
export default function setup(): void {
  const url =
    process.env.TEST_DATABASE_URL ??
    'postgresql://netflex:netflex-dev-only@localhost:54329/netflex_test';
  if (!/\/netflex_test(\?|$)/.test(url)) {
    throw new Error('TEST_DATABASE_URL must point at a database named netflex_test');
  }
  process.env.TEST_DATABASE_URL = url;
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
      `prisma migrate deploy failed on the test database:\n${err.stdout ?? ''}\n${err.stderr ?? ''}`,
    );
  }
}
