-- Add sensitive HR record columns to employment_profile (decision 0026).
-- All nullable; existing rows have no values. Additive, no backfill.
-- address: residential address; national_id: CCCD/CMND; bank_account: bank acct no; bank_name: bank name.
-- These are masked for non-privileged roles via canReadSensitiveHr + maskSensitive (packages/auth).
ALTER TABLE "employment_profile" ADD COLUMN IF NOT EXISTS "address" TEXT;
ALTER TABLE "employment_profile" ADD COLUMN IF NOT EXISTS "national_id" TEXT;
ALTER TABLE "employment_profile" ADD COLUMN IF NOT EXISTS "bank_account" TEXT;
ALTER TABLE "employment_profile" ADD COLUMN IF NOT EXISTS "bank_name" TEXT;
