-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "accessTokenVerifier" CHAR(64),
ADD COLUMN     "idempotencyKey" VARCHAR(100);

-- Guests read their order only with the token issued at checkout.
ALTER TABLE "orders" ADD CONSTRAINT "orders_guest_has_token" CHECK (
  "customerUserId" IS NOT NULL OR ("customerPhone" IS NOT NULL AND "accessTokenVerifier" IS NOT NULL));
ALTER TABLE "orders" ADD CONSTRAINT "orders_access_verifier_hex" CHECK (
  "accessTokenVerifier" IS NULL OR "accessTokenVerifier" ~ '^[0-9a-f]{64}$');
-- Device MACs stored in one canonical form.
ALTER TABLE "devices" ADD CONSTRAINT "devices_mac_format" CHECK ("macAddress" ~ '^([0-9a-f]{2}:){5}[0-9a-f]{2}$');
