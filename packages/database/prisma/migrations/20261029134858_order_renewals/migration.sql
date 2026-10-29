-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "renewsEntitlementId" UUID;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_renewsEntitlementId_fkey" FOREIGN KEY ("renewsEntitlementId") REFERENCES "entitlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A renewal link is part of the order's terms: immutable after creation.
CREATE OR REPLACE FUNCTION netflex_orders_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."amountMinor" IS DISTINCT FROM OLD."amountMinor" OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."planVersionId" IS DISTINCT FROM OLD."planVersionId" OR NEW."planSnapshot" IS DISTINCT FROM OLD."planSnapshot"
     OR NEW."scope" IS DISTINCT FROM OLD."scope" OR NEW."propertyId" IS DISTINCT FROM OLD."propertyId"
     OR NEW."reference" IS DISTINCT FROM OLD."reference"
     OR NEW."renewsEntitlementId" IS DISTINCT FROM OLD."renewsEntitlementId" THEN
    RAISE EXCEPTION 'netflex: order pricing/terms are immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
