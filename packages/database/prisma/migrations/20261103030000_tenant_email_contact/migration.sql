-- Tenants now sign in by email, so a tenant needs an email or (older accounts) a phone.
ALTER TABLE "users" DROP CONSTRAINT "users_contact_by_kind";
ALTER TABLE "users" ADD CONSTRAINT "users_contact_by_kind" CHECK (
  ("kind" = 'STAFF' AND "email" IS NOT NULL)
  OR ("kind" = 'TENANT' AND ("email" IS NOT NULL OR "phoneE164" IS NOT NULL))) NOT VALID;

-- Every sign-in code is addressed to someone.
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_recipient" CHECK (
  "email" IS NOT NULL OR "phoneE164" IS NOT NULL) NOT VALID;
