-- Fix: CHECK constraints pass when the expression is NULL. `NULL BETWEEN 1 AND 500`
-- is NULL, so room/floor plans without a member cap were accepted. Caught by
-- packages/database/src/constraints.int.test.ts.
ALTER TABLE "plan_versions" DROP CONSTRAINT "plan_versions_group_members";
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_group_members" CHECK (
  ("scope" = 'INDIVIDUAL' AND "maxGroupMembers" IS NULL)
  OR ("scope" <> 'INDIVIDUAL' AND "maxGroupMembers" IS NOT NULL AND "maxGroupMembers" BETWEEN 1 AND 500));
