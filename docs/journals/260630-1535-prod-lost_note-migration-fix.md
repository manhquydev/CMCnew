# Production outage: `lost_note` column missing on erp.cmcvn.edu.vn

**Date**: 2026-06-30 15:00
**Severity**: Critical
**Component**: API (CRM module / Opportunity queries)
**Status**: Resolved

## What Happened

Production site `https://erp.cmcvn.edu.vn/crm` returned a 500 error on page load:

> Khong tai duoc co hoi. Invalid `prisma.opportunity.findMany()` invocation: The column `opportunity.lost_note` does not exist in the current database.

The CRM page was completely down. Users could not see or manage opportunities.

## The Brutal Truth

This is a textbook deployment pipeline failure -- code shipped to production that referenced a database column that was never created. The API container was rebuilt and deployed via Jenkins, but the corresponding Prisma migration was never run against the production database. We had two separate processes for deploying (full compose script vs. individual container rebuilds) and they diverged on whether migrations were applied.

Worst part: this was entirely preventable. The migration files existed. The code worked in development. We just forgot to run `api-migrate` after the Jenkins pipeline deployed the new image.

## Technical Details

- **Error**: `column opportunity.lost_note does not exist` (PostgreSQL)
- **Code**: commit 47f16ab (merged via PR #11 into `main`) added `lostNote` field to the Prisma schema
- **Missing migrations** (2 files, 45 -> 47 total):
  - `20260629041613_sales_ops_foundations` -- creates `lost_note` column, converts `lost_reason` to `LostReason` enum, creates `opportunity_assignment` table with indexes
  - `20260629043000_opportunity_assignment_rls` -- RLS policies for the new table
- **Deployment context**: Jenkins pipeline rebuilt the API image from `main`, but the pipeline's deploy step skips migrations (it just replaces containers)
- **Database**: PostgreSQL on `152.42.167.189`, Docker container `cmcnew-prod-postgres-1`

## What We Tried

1. Identified the error from browser + API logs -- pointed clearly at missing column
2. Checked `_prisma_migrations` table -- only 45 entries, confirming the gap
3. Extracted raw SQL from both missing migration files
4. Ran both SQL scripts directly on the production database via SSH
5. Inserted corresponding records into `_prisma_migrations` to bring the tracked count to 47/47
6. Restarted API container to clear any stale Prisma client

## Root Cause

The deployment pipeline has two paths that diverged on migration discipline:

- **Full deploy** (`prod-server-deploy.sh`): has `api-migrate` as step [2/5], runs migrations as part of the script.
- **Container rebuild** (Jenkins pipeline): rebuilds the API image, replaces the container, but never runs `npx prisma migrate deploy` or an equivalent step.

The Jenkins pipeline was used this time because only the API image changed. The migration step was assumed to be "already applied" -- it wasn't.

## Lessons Learned

1. **Deployment paths must converge on migrations.** Whether full deploy or partial rebuild, one step must always apply pending migrations before declaring success. A shared post-deploy hook is better than trusting humans to remember.

2. **`_prisma_migrations` is the single source of truth.** If the tracked count differs from the migration files on disk, something is wrong. A pre-deploy check could catch this.

3. **Prisma's `migrate deploy` is idempotent.** There was no reason to skip it -- it would have been a no-op if migrations were current, and a fix if they weren't.

## Next Steps

- [ ] Add a migration check step to the Jenkins pipeline (or a post-deploy hook) that runs `npx prisma migrate deploy` after any API container rebuild.
- [ ] Consider a pre-flight health check that compares the Prisma schema version against `_prisma_migrations` and fails if they mismatch.
- [ ] Add monitoring on the CRM endpoint (HTTP 200 check) to catch this class of error faster.
