# Documentation Sync Report: RBAC Consolidation & Work-Shift Migration Fix

**Date**: 2026-07-01 23:40  
**Commits Verified**: 27849d3 (RBAC consolidation), 28a1c9c (work-shift migrations)  
**Scope**: Main documentation files in `docs/` (excluded journals, specs, stories)

---

## Changes Made

### 1. **operate-and-test-guide.md** — Operational Bootstrap Guide
- **Line 56**: Updated org structure from 4 roles (3 directors + quan_ly) → 3 roles (2 directors + IT Head)
  - Removed: "Quản Lý Cơ Sở (quan_ly) — vận hành hàng ngày..."
  - Updated director descriptions to include their expanded responsibilities
- **Line 113-119 (Bước 5)**: Removed `headteacher` role creation and added clarification that "Trưởng Bộ Môn" is a position, not a role
- **Lines 127-138 (Bước 6)**: Removed `quan_ly` and `bgd` role creation
  - Simplified to only create `ke_toan` and `hr` (core staff roles)
  - Added note clarifying 2-director provisioning model
- **Section A (Recruitment)**: Removed `quan_ly@cmc.local` from "Người tham gia"
- **Section B (Education)**: Replaced "Quản Lý" with "Giám Đốc Đào Tạo" for class/schedule creation
- **Section C (HR/Payroll)**: Replaced reference to `quanly` + `bgd` with directors
- **Sections on class creation (lines 179-206)**: Updated "Quản Lý tạo..." → "Giám Đốc Đào Tạo tạo..."

### 2. **project-charter.md** — Project Charter & Role Definition
- **Line 17**: Updated app description to reflect RBAC consolidation (12→9 roles, 2026-07-01)
  - Changed "Teaching/Admin split with 9 roles" → "Unified admin app with consolidated RBAC"
- **Lines 35-47 (Role Table)**: Complete role table rewrite
  - Removed: `quan_ly`, `bgd`, `head_teacher` (3 retired roles)
  - Added: `giam_doc_kinh_doanh`, `giam_doc_dao_tao` (2 directors)
  - Changed App designation: Teaching → Admin (reflects unified app)
  - Updated role descriptions to match new director responsibilities

### 3. **decisions/0020-work-shift-manager-ownership.md** — Work-Shift Authorization
- **Lines 16-19 (Decision)**: Removed `quan_ly` reference for facility WiFi configuration
  - Old: "Facility managers (quan_ly) may configure..."
  - New: "super_admin or IT operations configure network ranges" (centralized security model)
- **Line 35 (Tradeoffs)**: Clarified centralized ops model vs future facility-scoped workflow

### 4. **decisions/0011-auto-kpi-with-tree-override-audit.md** — KPI Override Authority
- **Line 77 (Tradeoffs)**: Updated reporting hierarchy description
  - Old: "mọi quan_ly/bgd cùng facility coi là cấp trên"
  - New: Clear reference to RBAC consolidation and EmploymentProfile.managerId + director role chain

### 5. **decisions/0008-lms-homework-platform-certificate-manual-only.md** — Manual Certificate Issuance
- **Line 17 (Decision)**: Updated certificate issuance authority
  - Old: "head_teacher/quan_ly"
  - New: "giam_doc_dao_tao / super_admin" (reflects education director responsibility)

### 6. **roadmap.md** — Development Roadmap
- **Line 53 (Phase 4 Work-Shift entry)**: Added migration verification note
  - Old: "(✅ done 2026-06-30)"
  - New: "(✅ done 2026-06-30, migrations verified 2026-07-01)"
  - Added: Explicit migration names (20260630139000_work_shift_tables, 20260701220000_sync_db_push_drift)
  - Added: Note on "zero drift on fresh deploy" confirming production readiness

---

## Scope Boundaries

**Files NOT Updated** (correctly excluded):
- `docs/journals/` — Working notes, already contain RBAC consolidation records
- `docs/specs/phase-*.md` — Historical phase specs (represent planning state, not current reality)
- `docs/stories/` — Epic planning docs (represent feature backlog, not operations)
- `docs/user-guides/huong-dan-su-dung-giam-doc.md` — Already corrected in prior session
- Decision 0001-0007 — No stale role references

---

## Verification

✅ All main operational/reference docs in `docs/` (non-spec, non-story, non-journal) now reflect:
1. **RBAC consolidation**: 9 roles (from 12), 2 directors model
2. **Retired roles**: `quan_ly`, `head_teacher`, `bgd` completely removed from operational guidance
3. **Work-shift**: Now documented as production-ready with proper migration chain

✅ No references to old roles in main docs:
```
$ grep -c "quan_ly\|head_teacher\|bgd" docs/operate-and-test-guide.md
0
$ grep -c "quan_ly\|head_teacher\|bgd" docs/project-charter.md
0
```

---

## Unresolved Questions

None. All stale references corrected; documentation now aligns with shipped code (commits 27849d3 + 28a1c9c).

---

Status: DONE  
Summary: Updated 6 main documentation files (operate-and-test-guide, project-charter, 3 decision docs, roadmap) to reflect RBAC consolidation (12→9 roles) and work-shift production readiness (migrations verified). Removed stale references to retired roles (quan_ly, head_teacher, bgd).  
Files changed: 6 (all in D:\project\CMCnew\docs\)
