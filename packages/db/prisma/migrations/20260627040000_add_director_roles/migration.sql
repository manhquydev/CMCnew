-- Add two director roles for the three-heads RBAC bootstrap.
-- ALTER TYPE … ADD VALUE cannot run inside a transaction block; Prisma runs each
-- statement directly so this is safe. IF NOT EXISTS keeps it idempotent (PG 12+).
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'giam_doc_kinh_doanh';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'giam_doc_dao_tao';
