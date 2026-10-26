-- Additive only: one enum, four nullable columns, one index. No existing row is
-- changed, so pre-existing days keep verificationStatus NULL (not a submission
-- under the verification workflow).
CREATE TYPE "AttendanceVerification" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

ALTER TABLE "AttendanceDay"
  ADD COLUMN "verificationStatus" "AttendanceVerification",
  ADD COLUMN "verifiedById" UUID,
  ADD COLUMN "verifiedAt" TIMESTAMP(3),
  ADD COLUMN "verificationNote" TEXT;

CREATE INDEX "AttendanceDay_outletId_verificationStatus_businessDate_idx"
  ON "AttendanceDay"("outletId", "verificationStatus", "businessDate");

-- A decision always names who and when; a rejection always carries a reason.
ALTER TABLE "AttendanceDay" ADD CONSTRAINT "AttendanceDay_decision_complete" CHECK (
  "verificationStatus" IS NULL
  OR "verificationStatus" = 'PENDING'
  OR ("verifiedById" IS NOT NULL AND "verifiedAt" IS NOT NULL)
);
ALTER TABLE "AttendanceDay" ADD CONSTRAINT "AttendanceDay_rejection_reason" CHECK (
  "verificationStatus" IS DISTINCT FROM 'REJECTED'
  OR ("verificationNote" IS NOT NULL AND length(btrim("verificationNote")) >= 5)
);
