-- Per-exercise star reward (earned by the student when the grade is published).
-- Default 10; teachers can tune per assignment. Avoids hardcoding the reward economy.
ALTER TABLE "exercise" ADD COLUMN "star_reward" INTEGER NOT NULL DEFAULT 10;
