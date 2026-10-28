import { DomainError } from './errors.js';

export const ACCESS_SCOPES = ['INDIVIDUAL', 'ROOM', 'FLOOR'] as const;
export type AccessScope = (typeof ACCESS_SCOPES)[number];

/** Exactly one target per scope. A FLOOR target never implies property-wide access. */
export type ScopeTarget =
  | { readonly scope: 'INDIVIDUAL'; readonly userId: string }
  | { readonly scope: 'ROOM'; readonly roomId: string }
  | { readonly scope: 'FLOOR'; readonly floorId: string };

/** Location of a room/floor as loaded from the database. */
export interface ResolvedLocation {
  readonly propertyId: string;
  readonly floorId: string | null;
  readonly roomId: string | null;
}

/** What an actor is authorized to buy for, as loaded from GroupAuthority + tenancy. */
export interface PurchaserAuthority {
  readonly userId: string;
  readonly propertyId: string;
  readonly roomIds: ReadonlySet<string>;
  readonly floorIds: ReadonlySet<string>;
}

export function scopeTargetId(target: ScopeTarget): string {
  switch (target.scope) {
    case 'INDIVIDUAL':
      return target.userId;
    case 'ROOM':
      return target.roomId;
    case 'FLOOR':
      return target.floorId;
  }
}

/** Ensure the resolved target exists inside the property the plan belongs to. */
export function assertTargetInProperty(
  target: ScopeTarget,
  resolved: ResolvedLocation | null,
  propertyId: string,
): void {
  if (target.scope === 'INDIVIDUAL') return; // user→property tenancy checked separately
  const ok =
    resolved !== null &&
    resolved.propertyId === propertyId &&
    (target.scope === 'ROOM'
      ? resolved.roomId === target.roomId
      : resolved.floorId === target.floorId);
  if (!ok) {
    throw new DomainError('INVALID_SCOPE_TARGET', 'Target is not part of this property', {
      scope: target.scope,
    });
  }
}

/**
 * Who may purchase for a target. Individuals buy for themselves; room/floor
 * purchases require explicit authority granted by a property administrator.
 */
export function canPurchaseFor(
  actor: PurchaserAuthority,
  target: ScopeTarget,
  propertyId: string,
): boolean {
  if (actor.propertyId !== propertyId) return false;
  switch (target.scope) {
    case 'INDIVIDUAL':
      return target.userId === actor.userId;
    case 'ROOM':
      return actor.roomIds.has(target.roomId);
    case 'FLOOR':
      return actor.floorIds.has(target.floorId);
  }
}
