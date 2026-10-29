import type { Actor } from '@netflex/domain';
import type { Request } from 'express';

export interface AuthContext {
  actor: Actor;
  sessionId: string;
  user: {
    id: string;
    kind: 'STAFF' | 'TENANT';
    displayName: string;
    mfaEnabled: boolean;
    mustChangePassword: boolean;
  };
  /** Staff: true once MFA was verified in this session. Tenants: always true. */
  mfaSatisfied: boolean;
}

export type AppRequest = Request & { id?: string | number; auth?: AuthContext };
