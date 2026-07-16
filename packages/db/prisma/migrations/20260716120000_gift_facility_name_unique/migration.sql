-- Idempotency guard for the gift-seed script (Phase 5, plan
-- 260716-0856-lms-schedule-rewards-exercises): prevents re-running the seed from creating
-- duplicate gifts per facility. A pre-migration duplicate check (GROUP BY facility_id, name
-- HAVING count(*) > 1) MUST be run against any target database before this migration is
-- applied there — verified clean against dev before this migration was created.
CREATE UNIQUE INDEX "gift_facility_id_name_key" ON "gift"("facility_id", "name");
