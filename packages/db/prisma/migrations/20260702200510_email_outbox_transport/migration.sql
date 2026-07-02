-- CreateEnum
CREATE TYPE "EmailTransport" AS ENUM ('graph', 'brevo');

-- AlterTable
ALTER TABLE "email_outbox" ADD COLUMN     "transport" "EmailTransport" NOT NULL DEFAULT 'graph';
