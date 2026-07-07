-- Teacher Lite direct provisioning bypasses receipt codes, so it needs its own
-- per-facility yearly student-code counter for HS-YYYY-NNNN allocation.
CREATE TABLE "student_code_counter" (
    "facility_id" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "last_seq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "student_code_counter_pkey" PRIMARY KEY ("facility_id","year")
);

ALTER TABLE "student_code_counter" ENABLE ROW LEVEL SECURITY;

CREATE POLICY student_code_counter_isolation ON "student_code_counter"
  USING (app_is_super_admin() OR facility_id = ANY (app_facility_ids()))
  WITH CHECK (app_is_super_admin() OR facility_id = ANY (app_facility_ids()));
