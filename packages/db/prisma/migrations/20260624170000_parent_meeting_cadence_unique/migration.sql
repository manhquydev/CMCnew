-- Auto-cadence idempotency: one meeting per (class, scheduled time) so regeneration never duplicates.
CREATE UNIQUE INDEX "parent_meeting_class_batch_id_scheduled_at_key" ON "parent_meeting"("class_batch_id", "scheduled_at");
