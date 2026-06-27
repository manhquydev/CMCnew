-- Migration: Add FK constraints for ClassSession.room_id and ClassSession.teacher_id.
-- Data-safety: null out any orphan IDs that would violate the new constraints BEFORE adding them.

-- Step 1: Null out orphan room_id values (room no longer exists in the room table).
UPDATE class_session
SET room_id = NULL
WHERE room_id IS NOT NULL
  AND room_id NOT IN (SELECT id FROM room);

-- Step 2: Null out orphan teacher_id values (user no longer exists in app_user).
UPDATE class_session
SET teacher_id = NULL
WHERE teacher_id IS NOT NULL
  AND teacher_id NOT IN (SELECT id FROM app_user);

-- Step 3: Add FK room_id → room(id) ON DELETE SET NULL (nullable).
ALTER TABLE "class_session"
  ADD CONSTRAINT "class_session_room_id_fkey"
  FOREIGN KEY ("room_id") REFERENCES "room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Step 4: Add FK teacher_id → app_user(id) ON DELETE SET NULL (nullable).
ALTER TABLE "class_session"
  ADD CONSTRAINT "class_session_teacher_id_fkey"
  FOREIGN KEY ("teacher_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
