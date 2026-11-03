-- Sign-in codes are now sent by email (no SMS provider).
ALTER TABLE "otp_challenges" ALTER COLUMN "phoneE164" DROP NOT NULL;
ALTER TABLE "otp_challenges" ADD COLUMN "email" VARCHAR(254);

-- CreateIndex
CREATE INDEX "otp_challenges_email_createdAt_idx" ON "otp_challenges"("email", "createdAt");
