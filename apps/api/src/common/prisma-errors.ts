import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@netflex/database';
import { ApiError } from './api-error.js';

/** Map a unique-constraint violation to a 409 with a safe message; rethrow anything else. */
export function conflictOnUnique(e: unknown, message: string): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    throw new ApiError(HttpStatus.CONFLICT, 'CONFLICT', message);
  }
  throw e;
}

export const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found.');
