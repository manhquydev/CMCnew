-- Principal-aware RLS (approved 2026-06-23, security-class).
--
-- Facility RLS (Phase 1) isolates by center but is too coarse for the LMS: a parent
-- must see ONLY their guardianed children, a student ONLY themselves. Two new
-- per-request GUCs carry the principal:
--   app.principal_kind : 'staff' | 'parent' | 'student'  (default 'staff' → unchanged staff behaviour)
--   app.student_ids    : uuid[]  (students the principal owns: child set / self)
--
-- Policies on student-owned tables become:
--   super OR (staff AND facility=ANY(facility_ids)) OR (principal<>staff AND <student-link> = ANY(student_ids))
-- WITH CHECK is tightened per write-path (only the actor that legitimately writes that row).
-- gift stays facility-only (a center catalog every principal in the facility may browse).

CREATE OR REPLACE FUNCTION app_principal_kind() RETURNS text
  LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('app.principal_kind', true), ''), 'staff');
$$;

CREATE OR REPLACE FUNCTION app_student_ids() RETURNS uuid[]
  LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN NULLIF(current_setting('app.student_ids', true), '') IS NULL THEN NULL
    ELSE string_to_array(current_setting('app.student_ids', true), ',')::uuid[]
  END;
$$;

-- ── student (PK = id) — staff by facility; parent/student by own id ──
DROP POLICY student_isolation ON student;
CREATE POLICY student_isolation ON student
  USING (
    app_is_super_admin()
    OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids()))
    OR (app_principal_kind() <> 'staff' AND id = ANY (app_student_ids()))
  )
  WITH CHECK (
    app_is_super_admin()
    OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids()))
  );

-- ── enrollment (student_id) — write: staff only ──
DROP POLICY enrollment_isolation ON enrollment;
CREATE POLICY enrollment_isolation ON enrollment
  USING (
    app_is_super_admin()
    OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids()))
    OR (app_principal_kind() <> 'staff' AND student_id = ANY (app_student_ids()))
  )
  WITH CHECK (
    app_is_super_admin()
    OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids()))
  );

-- ── submission (student_id) — write: staff OR the owning student ──
DROP POLICY submission_isolation ON submission;
CREATE POLICY submission_isolation ON submission
  USING (
    app_is_super_admin()
    OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids()))
    OR (app_principal_kind() <> 'staff' AND student_id = ANY (app_student_ids()))
  )
  WITH CHECK (
    app_is_super_admin()
    OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids()))
    OR (app_principal_kind() = 'student' AND student_id = ANY (app_student_ids()))
  );

-- ── star_transaction (student_id) — write: staff (earn/refund) OR the student (redeem spend) ──
DROP POLICY star_transaction_isolation ON star_transaction;
CREATE POLICY star_transaction_isolation ON star_transaction
  USING (
    app_is_super_admin()
    OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids()))
    OR (app_principal_kind() <> 'staff' AND student_id = ANY (app_student_ids()))
  )
  WITH CHECK (
    app_is_super_admin()
    OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids()))
    OR (app_principal_kind() = 'student' AND student_id = ANY (app_student_ids()))
  );

-- ── reward (student_id) — write: staff (review) OR the student (redeem) ──
DROP POLICY reward_isolation ON reward;
CREATE POLICY reward_isolation ON reward
  USING (
    app_is_super_admin()
    OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids()))
    OR (app_principal_kind() <> 'staff' AND student_id = ANY (app_student_ids()))
  )
  WITH CHECK (
    app_is_super_admin()
    OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids()))
    OR (app_principal_kind() = 'student' AND student_id = ANY (app_student_ids()))
  );

-- ── grade (no student_id → via submission) — write: staff (teacher) only ──
DROP POLICY grade_isolation ON grade;
CREATE POLICY grade_isolation ON grade
  USING (
    app_is_super_admin()
    OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids()))
    OR (app_principal_kind() <> 'staff' AND EXISTS (
      SELECT 1 FROM submission s
      WHERE s.id = grade.submission_id AND s.student_id = ANY (app_student_ids())
    ))
  )
  WITH CHECK (
    app_is_super_admin()
    OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids()))
  );

-- ── exercise (no student_id → via enrollment in the same class) — write: staff only ──
DROP POLICY exercise_isolation ON exercise;
CREATE POLICY exercise_isolation ON exercise
  USING (
    app_is_super_admin()
    OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids()))
    OR (app_principal_kind() <> 'staff' AND EXISTS (
      SELECT 1 FROM enrollment e
      WHERE e.class_batch_id = exercise.class_batch_id AND e.student_id = ANY (app_student_ids())
    ))
  )
  WITH CHECK (
    app_is_super_admin()
    OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids()))
  );
