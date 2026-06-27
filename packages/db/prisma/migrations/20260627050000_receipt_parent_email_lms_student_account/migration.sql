-- Add parent_email to receipt so LMS provisioning can notify the parent.
-- Nullable: existing receipts carry no email; optional at intake.
ALTER TABLE "receipt" ADD COLUMN IF NOT EXISTS "parent_email" TEXT;
