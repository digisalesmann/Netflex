-- AlterTable
ALTER TABLE "users" ADD COLUMN     "lastLoginAt" TIMESTAMPTZ(3),
ADD COLUMN     "mfaLastUsedStep" INTEGER,
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "passwordUpdatedAt" TIMESTAMPTZ(3);

-- Only the OWNER role may be granted platform-wide (propertyId NULL); every other
-- role must name a property. Enforced in the database so a service bug can't
-- create an all-properties support or finance account.
CREATE FUNCTION netflex_user_roles_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE role_key text;
BEGIN
  SELECT "key" INTO role_key FROM "roles" WHERE "id" = NEW."roleId";
  IF NEW."propertyId" IS NULL AND role_key <> 'OWNER' THEN
    RAISE EXCEPTION 'netflex: role % must be granted on a property', role_key USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."propertyId" IS NOT NULL AND role_key = 'OWNER' THEN
    RAISE EXCEPTION 'netflex: OWNER is only granted platform-wide' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER user_roles_guard BEFORE INSERT OR UPDATE ON "user_roles"
  FOR EACH ROW EXECUTE FUNCTION netflex_user_roles_guard();

-- Staff need an email; tenants need a phone. NOT VALID: enforced for every new or
-- updated row; existing rows are not re-checked (no production data exists, and
-- dev/test databases hold fixtures created before this rule). A later migration
-- should run VALIDATE CONSTRAINT once all environments are clean.
ALTER TABLE "users" ADD CONSTRAINT "users_contact_by_kind" CHECK (
  ("kind" = 'STAFF' AND "email" IS NOT NULL) OR ("kind" = 'TENANT' AND "phoneE164" IS NOT NULL)) NOT VALID;
ALTER TABLE "users" ADD CONSTRAINT "users_phone_e164" CHECK ("phoneE164" IS NULL OR "phoneE164" ~ '^\+[1-9][0-9]{7,14}$') NOT VALID;
ALTER TABLE "users" ADD CONSTRAINT "users_email_lower" CHECK ("email" IS NULL OR "email" = lower("email")) NOT VALID;
