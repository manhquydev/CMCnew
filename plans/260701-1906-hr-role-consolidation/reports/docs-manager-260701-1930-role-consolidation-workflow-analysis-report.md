# Role Consolidation — Post-Implementation Workflow Analysis

**Date:** 2026-07-01 | **Deliverable:** Functional workflows for 8 roles + stale docs  
**Consolidation:** 12 roles → 9. Delete: `quan_ly`, `head_teacher`, `bgd`.

---

## POST-CONSOLIDATION WORKFLOWS (by role)

### 1. giao_vien (Teacher)

- **Attendance marking** (`attendance.mark`, `shiftRegistration.*`)
- **Assessment lifecycle** (`assessment.*`, `grade.*`, `levelProgress.propose`)
- **Session evidence & documentation** (`sessionEvidence.*`)
- **Exercise & grading** (`exercise.*`, `submission.*`, `crm.testGrade`)
- **Parent communication** (`parentMeeting.setSchedule/setStatus`)
- **Work shift registration** (submit/register, approved by director/manager)
- **Check-in/out** via IP-gated punch clock

**No change from current.** Unchanged permissions → unchanged day-to-day.

---

### 2. sale (Sales Consultant)

- **CRM opportunity pipeline** (`crm.opportunityList/Create/Transition/MarkLost/Reopen`)
- **Contact management** (`crm.contactList/Create`)
- **Admissions test scheduling** (`crm.testCreate/List`) — NOT grading (teacher grades)
- **Enrollment & student update** (`enrollment.enroll`, `student.update`) — WITH `giam_doc_kinh_doanh` now (was `quan_ly`)
- **Work shift registration** (submit/register, approved by director/manager)
- **Check-in/out** via IP-gated punch clock

**Change:** Loses exclusive co-ownership with `quan_ly` on enrollment/student update (now shared with director), but workflow unchanged for day-to-day sales ops.

---

### 3. giam_doc_kinh_doanh (Business Director)

**NEW heavy permissions** from consolidation (was `quan_ly`/`bgd`):

- **After-sale lifecycle** — full authority (`afterSale.*`), including student lifecycle flagging (`setStudentLifecycle`) — **moved from quan_ly**
- **CRM full control** (`crm.*` except testGrade which is teacher-only)
- **Enrollment & student administration** (`enrollment.enroll`, `student.update`) — **NEW (shared with sale)**
- **Finance read + NEW write** (`finance.priceList/voucherList/receiptList`, **NOW receiptApprove/receiptCancel/receiptReconcile** — **NEW from quan_ly**)
- **Team staff management** (`user.list/create`, but not setRoles/setFacilities — those stay super_admin)
- **KPI approval chain** (`kpiEvalConfirm/Approve/Get/List`) — **NEW (was bgd)**
- **Shift approvals** (`shiftRegistration.approve/reject`)
- **Facility network management** (`facilityNetwork.*`) — **NEW from re-map**
- **Team delegation** via `DIRECTOR_ROLE_GRANTS` → can create `sale`, `cskh`, `ctv_mkt`, **NOW `ke_toan`, `hr`** — **NEW**

**Day in life:** Lands at dashboard → reviews KPI pending approval → approves finance receipts → manages CRM team → decides student lifecycle → approves shift requests.

---

### 4. giam_doc_dao_tao (Training Director)

**NEW heavy permissions** from consolidation (was `quan_ly`/`head_teacher`):

- **Assessment term & grading authority** (`assessment.*`)
- **Curriculum & room management** (`course.create/archive`, `room.create/update/archive`) — **NEW from quan_ly**
- **Badge creation** (`badge.create/archive`) — **NEW from quan_ly** (was quan_ly only)
- **Class lifecycle** (`classBatch.*`)
- **Schedule management** (`schedule.addSlot/generateSessions`)
- **Enrollment completion** (`enrollment.complete`) — **NEW from quan_ly**
- **Level-up decision authority** (`levelProgress.listPending/decide`)
- **Parent relationships** (`guardian.*`) — **NEW from re-map (was bgd/quan_ly)**
- **Team staff management** (`user.list/create/listTeachers`)
- **KPI approval chain** (`kpiEvalConfirm/Approve/Get/List`) — **NEW (was bgd)**
- **Shift approvals** (`shiftRegistration.approve/reject`)
- **Facility network management** (`facilityNetwork.*`) — **NEW from re-map**
- **Team delegation** via `DIRECTOR_ROLE_GRANTS` → can create `giao_vien` only (head_teacher deleted)

**Day in life:** Approves course setup → opens/manages classes & schedules → approves level-ups → manages parent records → KPI approval → shifts → facility settings.

---

### 5. ke_toan (Accountant)

- **Price & voucher creation** (`finance.priceCreate/voucherCreate`)
- **Receipt full lifecycle** (`finance.receiptList/Create/Approve/MarkSent/Reconcile/Cancel`)
- **Payroll & compensation** (`payroll.*`, `compensation.effective`)
- **KPI data prep** (`payroll.kpiEvalStart/Autofill/setAuto`, NOT confirm/approve — those are director/manager)
- **Monthly attendance report** (`checkInOut.monthlyReport`)
- **Can be delegated by** `giam_doc_kinh_doanh` (NEW in DIRECTOR_ROLE_GRANTS)

**No major change** except `giam_doc_kinh_doanh` can now create/assign them (was only quan_ly before consolidation deleted it).

---

### 6. hr (Human Resources)

- **Payroll data** (`payroll.*`) — all operations
- **Compensation baseline** (`compensation.effective`)
- **KPI data prep** (`payroll.kpiEval*Start/Autofill/setAuto`, **NOT confirm/approve**) — NOT approval decision
- **Attendance visibility** (`checkInOut.history/monthlyReport`)
- **User activity audit** (`user.viewActivity`)
- **Can be delegated by** `giam_doc_kinh_doanh` (NEW in DIRECTOR_ROLE_GRANTS)

**Unchanged** from current (quan_ly deletion doesn't affect HR workflows).

---

### 7. cskh (After-Sale Care)

- **Case management** (`afterSale.list/create/transition/assign`) — assign to team members
- **CRM pipeline collaboration** (`crm.*` except reassign which is director/quan_ly only)
- **Admissions test support** (`crm.testCreate/List`)
- **Work shift registration**
- **Check-in/out** via punch clock
- **Can be delegated by** `giam_doc_kinh_doanh`

**Unchanged** from current.

---

### 8. ctv_mkt (Marketing Collaborator)

- **CRM read + opportunity creation** (`crm.opportunityList/Get/Create/assignableOwners`)
- **Can be delegated by** `giam_doc_kinh_doanh`

**Unchanged** from current.

---

## DOCUMENTATION NEEDING UPDATE AFTER IMPLEMENTATION

**File: `docs/huong-dan-su-dung-giam-doc.md`**

| Line(s) | Current text | Issue | Fix |
|---------|--------------|-------|-----|
| 88 | "**KHÔNG làm được:** **đặt vòng đời học sinh** (`setStudentLifecycle`) — thao tác này có ảnh hưởng tài chính nên chỉ Quản Lý cơ sở mới làm." | Stale — after consolidation, GĐ Kinh Doanh GAINS this permission (phase-02 re-map). Quản Lý deleted. | Update § 3.4 (Chăm sóc khách hàng): "GĐ Kinh Doanh hiện CÓ quyền **đặt vòng đời học sinh** (`setStudentLifecycle`)." |
| 103 | "các thao tác ghi này thuộc Kế Toán / Quản Lý" | Stale — Quản Lý deleted. Only Kế Toán + GĐ Kinh Doanh handle finance writes now. | Update § 3.6: "...chỉ ghi thuộc **Kế Toán / GĐ Kinh Doanh**." |
| 121 | "Không quản lý phụ huynh (Phụ huynh là mục của Quản Lý)." | Stale — after consolidation, GĐ Kinh Doanh + GĐ Đào Tạo both gain `guardian.*` (phase-02 re-map). | Update § 3.9: Remove this bullet. Add new section describing guardian management (which directors now have). |
| 142–144 | "Các vai trò bạn được tạo: **Giáo Viên** (`giao_vien`) **Trưởng Bộ Môn** (`head_teacher`)" | Stale — `head_teacher` role deleted. Only `giao_vien` remains. | Update § 4.2: "Các vai trò bạn được tạo: **Giáo Viên** (`giao_vien`) chỉ. (Vai trò Trưởng Bộ Môn đã được gộp; giáo viên giàng bộ môn trỏ là giáo viên chính.)" |
| 211 | "không tạo vai trò ngoài giáo viên / trưởng bộ môn" | Stale — `head_teacher` deleted. | Update § 4.13: "không tạo vai trò ngoài giáo viên." |

**File: `docs/huong-dan-su-dung-sale-giao-vien.md`**

No stale role references. Sale section correctly reflects current & future permissions. Teacher section self-contained, no quan_ly/head_teacher/bgd mentions that would break.

**File: `docs/ARCHITECTURE.md`**

No role list / org chart section. Safe for consolidation.

---

## UNRESOLVED QUESTIONS

1. **Guardian access scope clarification:** Post-consolidation, both directors can now manage parents. Does this conflict with any expected data-scoping rules (e.g., can a director edit a student's parent record across facility boundaries)? Check RLS in `@cmc/db`.
2. **Finance approval authority:** GĐ Kinh Doanh now can approve receipts. Current docs hint "separation of duties" concern when KD dir also creates receipts (line 72, brainstorm). Should system enforce that one person cannot both create AND approve the same receipt?
3. **DIRECTOR_ROLE_GRANTS expansion:** GĐ Kinh Doanh now grants `ke_toan` and `hr` (was omitted before). Confirm this aligns with business intent (e.g., can KD director hire accountants unilaterally?).
4. **head_teacher → giao_vien migration:** No Phase 1 discovery on which live users hold `head_teacher` role and where they should remap. Impacts Phase 3 data migration.
