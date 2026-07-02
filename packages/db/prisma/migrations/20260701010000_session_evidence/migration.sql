-- Session evidence: persisted photos and structured teacher comments for LMS.
-- Draft rows are staff-only; published rows are visible to LMS principals only
-- when they own/enroll the student through app_student_ids().

CREATE TYPE "SessionEvidenceStatus" AS ENUM ('draft', 'published');

CREATE TABLE "session_evidence" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "class_session_id" UUID NOT NULL,
    "summary" TEXT,
    "internal_note" TEXT,
    "status" "SessionEvidenceStatus" NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMP(3),
    "published_by_id" UUID,
    "created_by_id" UUID,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_evidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "session_evidence_photo" (
    "id" UUID NOT NULL,
    "session_evidence_id" UUID NOT NULL,
    "photo_ref" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_evidence_photo_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "session_student_comment" (
    "id" UUID NOT NULL,
    "session_evidence_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "participation" TEXT,
    "strength" TEXT,
    "needs_improvement" TEXT,
    "teacher_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_student_comment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "session_evidence_class_session_id_key" ON "session_evidence"("class_session_id");
CREATE INDEX "session_evidence_facility_id_published_at_idx" ON "session_evidence"("facility_id", "published_at");
CREATE INDEX "session_evidence_status_idx" ON "session_evidence"("status");
CREATE INDEX "session_evidence_photo_session_evidence_id_idx" ON "session_evidence_photo"("session_evidence_id");
CREATE INDEX "session_evidence_photo_photo_ref_idx" ON "session_evidence_photo"("photo_ref");
CREATE UNIQUE INDEX "session_student_comment_session_evidence_id_student_id_key" ON "session_student_comment"("session_evidence_id", "student_id");
CREATE INDEX "session_student_comment_student_id_idx" ON "session_student_comment"("student_id");

ALTER TABLE "session_evidence"
  ADD CONSTRAINT "session_evidence_class_session_id_fkey"
  FOREIGN KEY ("class_session_id") REFERENCES "class_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "session_evidence"
  ADD CONSTRAINT "session_evidence_published_by_id_fkey"
  FOREIGN KEY ("published_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "session_evidence"
  ADD CONSTRAINT "session_evidence_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "session_evidence_photo"
  ADD CONSTRAINT "session_evidence_photo_session_evidence_id_fkey"
  FOREIGN KEY ("session_evidence_id") REFERENCES "session_evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "session_student_comment"
  ADD CONSTRAINT "session_student_comment_session_evidence_id_fkey"
  FOREIGN KEY ("session_evidence_id") REFERENCES "session_evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "session_student_comment"
  ADD CONSTRAINT "session_student_comment_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "session_evidence" ENABLE ROW LEVEL SECURITY;
CREATE POLICY session_evidence_isolation ON "session_evidence"
  USING (
    app_is_super_admin()
    OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids()))
    OR (
      app_principal_kind() <> 'staff'
      AND status = 'published'
      AND published_at IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM class_session cs
        JOIN enrollment e ON e.class_batch_id = cs.class_batch_id
        WHERE cs.id = session_evidence.class_session_id
          AND e.student_id = ANY (app_student_ids())
          AND e.archived_at IS NULL
      )
    )
  )
  WITH CHECK (
    app_is_super_admin()
    OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids()))
  );

ALTER TABLE "session_evidence_photo" ENABLE ROW LEVEL SECURITY;
CREATE POLICY session_evidence_photo_isolation ON "session_evidence_photo"
  USING (
    app_is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM session_evidence se
      WHERE se.id = session_evidence_photo.session_evidence_id
        AND (
          (app_principal_kind() = 'staff' AND se.facility_id = ANY (app_facility_ids()))
          OR (
            app_principal_kind() <> 'staff'
            AND se.status = 'published'
            AND se.published_at IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM class_session cs
              JOIN enrollment e ON e.class_batch_id = cs.class_batch_id
              WHERE cs.id = se.class_session_id
                AND e.student_id = ANY (app_student_ids())
                AND e.archived_at IS NULL
            )
          )
        )
    )
  )
  WITH CHECK (
    app_is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM session_evidence se
      WHERE se.id = session_evidence_photo.session_evidence_id
        AND app_principal_kind() = 'staff'
        AND se.facility_id = ANY (app_facility_ids())
    )
  );

ALTER TABLE "session_student_comment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY session_student_comment_isolation ON "session_student_comment"
  USING (
    app_is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM session_evidence se
      WHERE se.id = session_student_comment.session_evidence_id
        AND (
          (app_principal_kind() = 'staff' AND se.facility_id = ANY (app_facility_ids()))
          OR (
            app_principal_kind() <> 'staff'
            AND se.status = 'published'
            AND se.published_at IS NOT NULL
            AND session_student_comment.student_id = ANY (app_student_ids())
          )
        )
    )
  )
  WITH CHECK (
    app_is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM session_evidence se
      WHERE se.id = session_student_comment.session_evidence_id
        AND app_principal_kind() = 'staff'
        AND se.facility_id = ANY (app_facility_ids())
    )
  );
