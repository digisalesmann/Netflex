-- NetFlex integrity constraints that Prisma's schema language cannot express.
-- Documented in docs/architecture/database.md. Each rule backs a spec requirement (§21).

-- ------------------------------------------------------------------ Money
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_price_positive" CHECK ("priceMinor" > 0);
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "orders" ADD CONSTRAINT "orders_amount_positive" CHECK ("amountMinor" > 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK ("amountMinor" > 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "payments" ADD CONSTRAINT "payments_refunded_range" CHECK ("refundedMinor" >= 0 AND "refundedMinor" <= "amountMinor");
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amount_positive" CHECK ("amountMinor" > 0);
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$');
-- Two-person rule: the requester cannot approve their own refund.
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_four_eyes" CHECK ("approvedById" IS NULL OR "approvedById" <> "requestedById");

-- ------------------------------------------------------------------ Plan versions
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_duration_positive" CHECK ("durationValue" > 0);
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_devices" CHECK (
  "maxDevices" BETWEEN 1 AND 500 AND "maxConcurrentSessions" BETWEEN 1 AND "maxDevices");
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_redemption_window_pair" CHECK (
  ("redemptionWindowValue" IS NULL) = ("redemptionWindowUnit" IS NULL)
  AND ("redemptionWindowValue" IS NULL OR "redemptionWindowValue" > 0));
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_rates" CHECK (
  ("downloadKbps" IS NULL OR "downloadKbps" >= 64) AND ("uploadKbps" IS NULL OR "uploadKbps" >= 64));
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_group_members" CHECK (
  ("scope" = 'INDIVIDUAL' AND "maxGroupMembers" IS NULL)
  OR ("scope" <> 'INDIVIDUAL' AND "maxGroupMembers" BETWEEN 1 AND 500));
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_availability" CHECK (
  "availableFrom" IS NULL OR "availableUntil" IS NULL OR "availableFrom" < "availableUntil");

-- ------------------------------------------------------------------ Scope targets (exactly one per scope)
-- INDIVIDUAL may have no user (guest checkout); ROOM/FLOOR must name exactly their target.
ALTER TABLE "orders" ADD CONSTRAINT "orders_scope_target" CHECK (
  ("scope" = 'INDIVIDUAL' AND "targetRoomId" IS NULL AND "targetFloorId" IS NULL)
  OR ("scope" = 'ROOM' AND "targetRoomId" IS NOT NULL AND "targetUserId" IS NULL AND "targetFloorId" IS NULL)
  OR ("scope" = 'FLOOR' AND "targetFloorId" IS NOT NULL AND "targetUserId" IS NULL AND "targetRoomId" IS NULL));
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_scope_target" CHECK (
  ("scope" = 'INDIVIDUAL' AND "targetRoomId" IS NULL AND "targetFloorId" IS NULL)
  OR ("scope" = 'ROOM' AND "targetRoomId" IS NOT NULL AND "targetUserId" IS NULL AND "targetFloorId" IS NULL)
  OR ("scope" = 'FLOOR' AND "targetFloorId" IS NOT NULL AND "targetUserId" IS NULL AND "targetRoomId" IS NULL));
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_scope_target" CHECK (
  ("scope" = 'INDIVIDUAL' AND "targetRoomId" IS NULL AND "targetFloorId" IS NULL)
  OR ("scope" = 'ROOM' AND "targetRoomId" IS NOT NULL AND "targetUserId" IS NULL AND "targetFloorId" IS NULL)
  OR ("scope" = 'FLOOR' AND "targetFloorId" IS NOT NULL AND "targetUserId" IS NULL AND "targetRoomId" IS NULL));
ALTER TABLE "group_authorities" ADD CONSTRAINT "group_authorities_target" CHECK (
  ("scope" = 'ROOM' AND "roomId" IS NOT NULL AND "floorId" IS NULL)
  OR ("scope" = 'FLOOR' AND "floorId" IS NOT NULL AND "roomId" IS NULL));

-- ------------------------------------------------------------------ Entitlements: coherent time window
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_window" CHECK (
  ("startsAt" IS NULL AND "expiresAt" IS NULL)
  OR ("startsAt" IS NOT NULL AND "expiresAt" IS NOT NULL AND "startsAt" < "expiresAt"));
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_active_has_window" CHECK (
  "status" NOT IN ('ACTIVE', 'SUSPENDED') OR "expiresAt" IS NOT NULL);
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_limits" CHECK (
  "maxDevices" >= 1 AND "maxConcurrentSessions" BETWEEN 1 AND "maxDevices");

-- ------------------------------------------------------------------ Vouchers
-- Paid vouchers must reference an order; any other issuance needs an issuer and a reason.
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_issuance_record" CHECK (
  ("issuanceType" = 'PAID' AND "orderId" IS NOT NULL)
  OR ("issuanceType" <> 'PAID' AND "issuedById" IS NOT NULL AND "issueReason" IS NOT NULL AND length(trim("issueReason")) > 0));
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_hint_format" CHECK ("hint" ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$');
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_verifier_hex" CHECK ("verifier" ~ '^[0-9a-f]{64}$');
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_revoked_has_time" CHECK ("status" <> 'REVOKED' OR "revokedAt" IS NOT NULL);
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_issued_has_time" CHECK ("status" = 'GENERATED' OR "status" = 'REVOKED' OR "issuedAt" IS NOT NULL);

-- ------------------------------------------------------------------ OTP / misc
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_attempts_range" CHECK ("attempts" >= 0 AND "attempts" <= "maxAttempts");
ALTER TABLE "network_operations" ADD CONSTRAINT "network_operations_attempts" CHECK ("attempts" >= 0 AND "maxAttempts" >= 1);
ALTER TABLE "tenant_assignments" ADD CONSTRAINT "tenant_assignments_window" CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt");

-- ------------------------------------------------------------------ Partial unique indexes
-- At most one successful payment per order (prevents double charge being fulfilled twice).
CREATE UNIQUE INDEX "payments_one_success_per_order" ON "payments" ("orderId")
  WHERE "status" IN ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED');
-- One open room assignment per tenant per property.
CREATE UNIQUE INDEX "tenant_assignments_one_open" ON "tenant_assignments" ("userId", "propertyId") WHERE "endsAt" IS NULL;
-- One live voucher per entitlement (reissue revokes the old one first).
CREATE UNIQUE INDEX "vouchers_one_live_per_entitlement" ON "vouchers" ("entitlementId")
  WHERE "entitlementId" IS NOT NULL AND "status" NOT IN ('REVOKED', 'EXPIRED');
-- A device holds at most one active slot on a voucher.
CREATE UNIQUE INDEX "voucher_redemptions_one_active" ON "voucher_redemptions" ("voucherId", "deviceId") WHERE "releasedAt" IS NULL;
-- One active membership per user per group subscription.
CREATE UNIQUE INDEX "group_memberships_one_active" ON "group_memberships" ("subscriptionId", "userId") WHERE "removedAt" IS NULL;
-- One active authority per user per room / floor.
CREATE UNIQUE INDEX "group_authorities_room_active" ON "group_authorities" ("userId", "roomId") WHERE "revokedAt" IS NULL AND "roomId" IS NOT NULL;
CREATE UNIQUE INDEX "group_authorities_floor_active" ON "group_authorities" ("userId", "floorId") WHERE "revokedAt" IS NULL AND "floorId" IS NOT NULL;
-- Active role grants are unique, including platform-wide (NULL property) grants.
CREATE UNIQUE INDEX "user_roles_active_unique" ON "user_roles" ("userId", "roleId", "propertyId") NULLS NOT DISTINCT WHERE "revokedAt" IS NULL;
CREATE UNIQUE INDEX "system_settings_scope_key" ON "system_settings" ("propertyId", "key") NULLS NOT DISTINCT;
-- Outbox relay scan.
CREATE INDEX "outbox_events_pending" ON "outbox_events" ("availableAt") WHERE "dispatchedAt" IS NULL;
-- Expiry scan.
CREATE INDEX "entitlements_expiry_due" ON "entitlements" ("expiresAt") WHERE "status" IN ('ACTIVE', 'SUSPENDED', 'PROVISIONING', 'PROVISIONING_FAILED');

-- ------------------------------------------------------------------ Immutability triggers
CREATE FUNCTION netflex_reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'netflex: % on % is not allowed (%)', TG_OP, TG_TABLE_NAME, TG_ARGV[0]
    USING ERRCODE = 'integrity_constraint_violation';
END $$;

-- Audit log is append-only.
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION netflex_reject_change('audit log is append-only');
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION netflex_reject_change('audit log is append-only');

-- Plan versions are immutable once locked by their first order; lock cannot be removed.
CREATE FUNCTION netflex_plan_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."lockedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'netflex: locked plan version % cannot be deleted', OLD."id" USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."lockedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'netflex: locked plan version % is immutable', OLD."id" USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER plan_versions_guard BEFORE UPDATE OR DELETE ON "plan_versions"
  FOR EACH ROW EXECUTE FUNCTION netflex_plan_version_guard();

-- Financial and contractual fields never change after insert.
CREATE FUNCTION netflex_orders_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."amountMinor" IS DISTINCT FROM OLD."amountMinor" OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."planVersionId" IS DISTINCT FROM OLD."planVersionId" OR NEW."planSnapshot" IS DISTINCT FROM OLD."planSnapshot"
     OR NEW."scope" IS DISTINCT FROM OLD."scope" OR NEW."propertyId" IS DISTINCT FROM OLD."propertyId"
     OR NEW."reference" IS DISTINCT FROM OLD."reference" THEN
    RAISE EXCEPTION 'netflex: order pricing/terms are immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER orders_guard BEFORE UPDATE ON "orders" FOR EACH ROW EXECUTE FUNCTION netflex_orders_guard();

CREATE FUNCTION netflex_payments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."amountMinor" IS DISTINCT FROM OLD."amountMinor" OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."orderId" IS DISTINCT FROM OLD."orderId" OR NEW."provider" IS DISTINCT FROM OLD."provider"
     OR NEW."providerReference" IS DISTINCT FROM OLD."providerReference" THEN
    RAISE EXCEPTION 'netflex: payment identity/amount is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payments_guard BEFORE UPDATE ON "payments" FOR EACH ROW EXECUTE FUNCTION netflex_payments_guard();
CREATE TRIGGER payments_no_delete BEFORE DELETE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION netflex_reject_change('payments are financial history');
CREATE TRIGGER payment_events_no_delete BEFORE DELETE ON "payment_events"
  FOR EACH ROW EXECUTE FUNCTION netflex_reject_change('payment events are financial history');
CREATE TRIGGER refunds_no_delete BEFORE DELETE ON "refunds"
  FOR EACH ROW EXECUTE FUNCTION netflex_reject_change('refunds are financial history');
CREATE TRIGGER orders_no_delete BEFORE DELETE ON "orders"
  FOR EACH ROW EXECUTE FUNCTION netflex_reject_change('orders are financial history');

CREATE FUNCTION netflex_subscriptions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."planSnapshot" IS DISTINCT FROM OLD."planSnapshot" OR NEW."planVersionId" IS DISTINCT FROM OLD."planVersionId"
     OR NEW."orderId" IS DISTINCT FROM OLD."orderId" OR NEW."scope" IS DISTINCT FROM OLD."scope" THEN
    RAISE EXCEPTION 'netflex: subscription terms are immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER subscriptions_guard BEFORE UPDATE ON "subscriptions" FOR EACH ROW EXECUTE FUNCTION netflex_subscriptions_guard();
