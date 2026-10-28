-- Replace the NULLS NOT DISTINCT unique index with two partial unique indexes.
-- Same rule (one value per key per scope), but expressed so Prisma does not see drift.
DROP INDEX "system_settings_scope_key";
CREATE UNIQUE INDEX "system_settings_platform_key" ON "system_settings" ("key") WHERE "propertyId" IS NULL;
CREATE UNIQUE INDEX "system_settings_property_key" ON "system_settings" ("propertyId", "key") WHERE "propertyId" IS NOT NULL;
