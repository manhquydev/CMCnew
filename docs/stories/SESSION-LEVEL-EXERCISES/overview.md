# Overview

## Current Behavior

Exercises are global curriculum assets attached to `CurriculumUnit`. One unit can
only have one homework exercise and one periodic-test exercise because
`Exercise` is unique by `(curriculumUnitId, type)`.

## Target Behavior

Directors upload homework/test assets per lesson slot. A course with 12 units and
48 sessions has 48 lesson slots. Class sessions map to lesson slots; students see
only exercises whose mapped class session has ended; teachers grade by concrete
session/class context.

## Affected Users

- Giám đốc đào tạo: uploads and publishes exercises by lesson/session slot.
- Giáo viên: grades submissions for the session/class they taught.
- Học sinh/phụ huynh: sees opened homework for completed sessions only.

## Affected Product Docs

- `docs/decisions/0038-session-level-exercises.md`
- `docs/operate-and-test-guide.md`
- `docs/specs/phase-02-assessment-lms.md`
- `docs/DECISION_INDEX.md`

## Non-Goals

- No per-class custom worksheet override in this slice.
- No new online-class/video learning mode.
- No weakening of submission/grade RLS.
