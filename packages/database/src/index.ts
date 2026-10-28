import { PrismaClient } from '@prisma/client';

export { Prisma, PrismaClient } from '@prisma/client';
export type * from '@prisma/client';

/** Create a Prisma client. Logs only warnings/errors; query logging is never enabled (it could leak PII). */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: ['warn', 'error'] });
}

/** Postgres error codes NetFlex maps to stable API errors. */
export const PG_ERROR = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  INTEGRITY_CONSTRAINT_VIOLATION: '23000',
  SERIALIZATION_FAILURE: '40001',
} as const;
