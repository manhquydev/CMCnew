-- R2: activation/password-reset is superseded by Microsoft SSO (staff) + Email OTP (parent), so the
-- activation token store is dropped, and a parent's password becomes optional (OTP is their login).

DROP TABLE IF EXISTS "activation_token";
DROP TYPE IF EXISTS "ActivationKind";

ALTER TABLE "parent_account" ALTER COLUMN "password_hash" DROP NOT NULL;
