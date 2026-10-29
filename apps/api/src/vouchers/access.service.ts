import { Inject, Injectable } from '@nestjs/common';
import type { NetflexConfig } from '@netflex/config';
import {
  computeVoucherVerifier,
  generateVoucherCode,
  voucherHint,
  type IssuanceType,
} from '@netflex/domain';
import { grantAccess, type GrantAccessInput, type GrantedAccess, type Tx } from '@netflex/core';

export type { GrantAccessInput, GrantedAccess };
import { CONFIG } from '../infra/tokens.js';

/**
 * Creates the access chain for one purchase or issuance (spec §8.5): a
 * Subscription (contract + immutable plan snapshot), an Entitlement (what the
 * network should allow) and a Voucher (the credential, stored only as a keyed
 * verifier). Used by admin issuance now and by verified payments in Phase 4.
 */
@Injectable()
export class AccessService {
  constructor(@Inject(CONFIG) private readonly config: NetflexConfig) {}

  grant(tx: Tx, input: GrantAccessInput): Promise<GrantedAccess> {
    return grantAccess(
      tx,
      { pepper: this.config.VOUCHER_PEPPER, pepperVersion: this.config.VOUCHER_PEPPER_VERSION },
      input,
    );
  }

  /** New credential for an existing entitlement (lost code). The old voucher must already be revoked. */
  async reissue(
    tx: Tx,
    old: {
      id: string;
      propertyId: string;
      scope: 'INDIVIDUAL' | 'ROOM' | 'FLOOR';
      issuanceType: IssuanceType;
      orderId: string | null;
      entitlementId: string | null;
      redeemBy: Date | null;
      status: string;
    },
    actorId: string,
    reason: string,
  ) {
    const code = generateVoucherCode();
    const v = await tx.voucher.create({
      data: {
        propertyId: old.propertyId,
        verifier: computeVoucherVerifier(this.config.VOUCHER_PEPPER, code),
        verifierKeyVersion: this.config.VOUCHER_PEPPER_VERSION,
        hint: voucherHint(code),
        status: 'ISSUED',
        issuanceType: old.issuanceType,
        scope: old.scope,
        orderId: old.orderId,
        entitlementId: old.entitlementId,
        // Non-paid vouchers need an issuer + reason; paid reissues record them too.
        issuedById: actorId,
        issueReason: `reissue: ${reason}`,
        redeemBy: old.redeemBy,
        replacesVoucherId: old.id,
        issuedAt: new Date(),
      },
    });
    return { voucherId: v.id, code, hint: v.hint };
  }
}
