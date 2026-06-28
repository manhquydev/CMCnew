# QA Audit — Docs / E2E / Frontend vs tonight's changes (commits 3824b45..59df909)

Date: 2026-06-27 23:27 · Lead synthesis of 4 sub-audits · READ-ONLY (no code/docs modified)

## Verdict at a glance

| Area | Status | Worst item |
| --- | --- | --- |
| A. Role docs | minor-gaps | Certificate hidden but still taught as a live feature |
| B. E2E coverage | major-gaps | 0/8 critical flows fully covered; revenue/provisioning path never submitted |
| C. Frontend | minor-gaps | Admin lint gate RED (unused `Select`); kpiOverride unwired |

The two items flagged highest-risk in the brief are already CORRECT in both code and docs: (1) the "Tạo người dùng" form has NO password field and is documented SSO-only; (2) KPI directors confirm+approve only, cannot edit scores, and docs reflect this. Remaining issues are staleness/reachability gaps, not contradictions of tonight's changes.

---

## A. Tài liệu vai trò — sai/thiếu cần sửa (ưu tiên)

### A1 [medium] Certificate dạy như tính năng sống, nhưng đã bị ẩn khỏi nav
- Evidence: `apps/admin/src/shell.tsx:381` hardcodes certificate nav `visible:false` ("Tính năng chứng chỉ tạm tắt (chưa dùng)"). Registry still grants `certificate.list/issue` (`packages/auth/src/permissions.ts:120-122`) so capability exists but the menu never renders.
- Hits BOTH guides:
  - GĐ guide `docs/huong-dan-su-dung-giam-doc.md:35`, `:129`, `:274`, section 4.10 ("Cấp chứng chỉ … issue").
  - Sale/GV guide `docs/huong-dan-su-dung-sale-giao-vien.md:78` ("Chứng chỉ (xem)"), section 3.7 `:110-115`.
- Fix: Either re-enable nav (`shell.tsx` set `visible('certificate')`) OR mark every reference above "tạm ẩn (chưa dùng)". Pick one source of truth — the nav flag is the live signal, so docs should follow it until re-enabled.

### A2 [medium] GĐ Kinh Doanh — menu list bỏ sót các trang "open" read-only thực tế hiển thị
- Evidence: `nav-permissions.ts:28,32,35` mark schedule/classes/courses (+ overview/my-payslips) as gate kind `open` = visible to ANY authenticated staff. So GĐ KD DOES see Lịch dạy / Lớp học / Khóa học (read-only). Doc `docs/huong-dan-su-dung-giam-doc.md:53` + section 3.9 imply they are absent; line-10/line-272 promise ("Menu chỉ hiện đúng phần việc của bạn; thiếu nút = thiếu quyền") is inaccurate for open sections.
- Fix: In section 3 (and the line-10/272 framing) note that Lịch dạy / Lớp học / Khóa học / Tổng quan are read-only browse pages visible to all staff; only action buttons inside are permission-gated.

### A3 [high E2E / low doc] KPI self-submit dạy như việc thường ngày của sale/GV nhưng KHÔNG có UI tới được
- Evidence: `docs/huong-dan-su-dung-sale-giao-vien.md:57-59,121-123,146` tell sale/GV they "tự nộp phiếu KPI (kpiEvalSubmit)". Only KPI UI is `KpiEvaluationPanel`, rendered under nav `kpi` (`App.tsx:730-734`) gated to `payroll.kpiList = [hr, ke_toan]` (`nav-permissions.ts:96-99`) — sale/GV never see it. Inside, `kpiEvalGet` is `[hr, ke_toan, giam_doc_kinh_doanh, giam_doc_dao_tao]` (`permissions.ts:175`) — also excludes them. Backend `kpiEvalSubmit` is `protectedProcedure` (`payroll.ts:786`) so the capability exists with no entry point.
- Fix (doc): correct guide to state sale/GV submit via HR/manager-mediated flow, NOT a self-serve menu. (Frontend counterpart = C-area "KPI của tôi" entry point — see C2/Open-Q.)

### A4 [medium] Badge/Huy hiệu — mô tả tính năng không có frontend
- Evidence: `docs/huong-dan-su-dung-sale-giao-vien.md:117-119,145` say GV "trao huy hiệu (grant)". `badge.grant=[giao_vien,head_teacher,quan_ly]` exists (`permissions.ts:49`) but there is NO badge UI: no `badge` key in `SectionKey` (`shell.tsx:36-63`), no nav item, no panel (grep finds only Mantine `<Badge>`). Unreachable.
- Fix: Remove the badge sub-section from the teacher guide (or mark not-yet-available); re-add when a panel ships.

### A5 [low] "Duyệt cấp độ" listed as GV menu, but teachers propose from inside Học bạ
- Evidence: `docs/huong-dan-su-dung-sale-giao-vien.md:78` lists "Duyệt cấp độ (chỉ đề xuất)" as a GV menu. `levelup` nav gated to `levelProgress.listPending` = `[head_teacher, quan_ly, giam_doc_dao_tao]` (`permissions.ts:131`) — excludes giao_vien. Teacher's propose lives inside assessment panel (`assessment-panel.tsx:204-247` → `levelProgress.propose`).
- Fix: Reword §3 intro — teachers propose level-ups from within Học bạ, not a standalone menu. §3.7 wording is fine.

### A6 [low] `resetLmsPassword` (granted to both directors) undocumented + reachability gap
- Evidence: `permissions.ts:203` grants `student.resetLmsPassword` to `[quan_ly, giam_doc_kinh_doanh, giam_doc_dao_tao]`; button at `student-detail.tsx:89`. Neither director section mentions it. The "Học sinh" nav is gated `student.update = [quan_ly, sale]`, so the panel — and thus the button — is NOT visible to directors today (latent capability = doc gap + reachability gap).
- Fix: Add a one-line capability note in director guide §3/§4/§5; and verify the reset button is reachable for directors since the Học sinh panel is gated away from them.

### A7 [low] Create-user §5 step-2 omits required "Vai trò chính" (primaryRole)
- Evidence: actual form (`App.tsx:339-348`) collects Email, Tên hiển thị, Vai trò (MultiSelect), Vai trò chính (`App.tsx:344`), Cơ sở. Director guide §5 step-2 lists all but "Vai trò chính".
- Fix: Add "Vai trò chính" to the field list (auto-defaults to first selected role if blank).

### A-POSITIVE (no change needed — recorded so not mistaken for gaps)
- No-password SSO-only create flow is accurately documented: `App.tsx:330` "không cần đặt mật khẩu"; director guide §5 + login section, sale/GV guide lines 16-23,142-143. Matches fail-closed login in `apps/api/src/routers/auth.ts`.
- KPI authority accurate: `kpiEvalConfirm=[quan_ly,bgd,giam_doc_kinh_doanh,giam_doc_dao_tao]`, `kpiEvalApprove=[bgd,giam_doc_kinh_doanh,giam_doc_dao_tao]` (`permissions.ts:173-174`); approver≠confirmer enforced (`payroll.ts:879`); directors cannot `kpiOverride` (`apps/api/src/lib/kpi-authz.ts:18-30` excludes them). Docs correctly omit score-editing for directors. Optional: state in director §6 that "Điều chỉnh KPI" is a Quản Lý/tree-manager action.
- passMark server-controlled, not teacher-entered: sale/GV §3.4 describes only computeFinalGrade, consistent with `assessment.ts:184,273` PASS_MARK constant.

---

## B. Độ phủ E2E — luồng thiếu + đề xuất (xếp ưu tiên)

Current state: `apps/e2e` = 4 smoke specs / 13 tests / 206 lines, driving real React apps (api:4000, admin:5173, lms:5175). Real frontend WRITES exist in only 2 places: admin create-course, and LMS student login render. Of 8 critical flows: **0 fully covered, 3 partial, 5 zero**. Backend tRPC tests (~40) cover these flows but never touch React.

| Flow | Frontend E2E status | Backend-only coverage |
| --- | --- | --- |
| (a) create staff (SSO-only form) | ZERO | `director-user-create.int.test.ts` |
| (b) staff login fail-closed + SSO | partial (super_admin happy + wrong-pw only) | auth.ts rules |
| (c) KPI confirm/approve (directors) | ZERO | kpi-evaluation-workflow, kpi-override-audit, director-kpi-and-welcome |
| (d) CRM pipeline O1→O5 | ZERO (navlink visibility only) | crm-hooks, crm-opportunity-lost-reopen, commission-for-sale-e2e |
| (e) receipt approve → student + LMS provision | partial (form reachable, never submitted) | aftersale-student-lifecycle, lms-student-account-provisioning |
| (f) LMS homework submit + grading + grade view | partial (login + parent OTP step-1 only) | lms-full-lifecycle-e2e, assessment-final-grade-publish |
| (g) attendance marking | ZERO | — |
| (h) payroll computation | ZERO (roster render only) | — |

### Proposed E2E additions (priority order)

1. **[P0] (e) Receipt approve → student + LMS provisioning (full chain).** Core revenue+provisioning path. `unified-staff-shell.spec.ts:37-47` only asserts the "Học sinh mới" fields visible. Extend: create draft receipt for a new parent phone → approve → assert student appears in Học sinh AND an LMS loginCode is issued **facility-prefixed** (e.g. `HQ-HS-...`, per tonight's change).
2. **[P0] (a) Create staff via SSO-only form.** `App.tsx:326-356` posts `user.create` with no password. No spec opens "Tạo người dùng". Add: super_admin opens modal, **assert NO "Mật khẩu" field exists** (regression guard for SSO-only change), fill email+displayName+role, submit, expect "Đã tạo người dùng" toast + new roster row. Second case as a director (giam_doc_kinh_doanh) to cover their new create authority.
3. **[P1] (c) KPI confirm/approve by directors.** `kpi-evaluation-panel.tsx` referenced by no spec; tonight's rules only at tRPC layer. Add as a director: open sheet → **assert score inputs read-only when not draft** → "Xác nhận" → verify scores unchanged → "Điều chỉnh KPI" (kpiOverride) succeeds on non-approved sheet but blocked after approval. (NOTE: blocked on C2 — kpiOverride has no UI yet.)
4. **[P1] (f) LMS homework submit + teacher grading + grade view.** `lms-smoke.spec.ts` stops at login + OTP step-1. Add chain: student logs in → opens assigned exercise → submits; teacher (admin) opens grading → enters score (passMark server-controlled, not teacher-entered) → publishes; student re-opens and sees grade. Seed a deterministic/dev OTP so parent step-2 can complete.
5. **[P1] (b) Staff login fail-closed.** `admin-smoke.spec.ts:17-35` only covers super_admin happy + wrong-pw. Add: (1) non-super_admin seeded staff password login → expect fail-closed / SSO-only message; (2) assert SSO entry control present. Pin the super_admin-seed assumption in the happy-path comment.
6. **[P2] (d) CRM pipeline O1→O5.** `unified-staff-shell.spec.ts:34` only asserts navlink visible. Add: create opportunity, advance O1→O5, assert won deal surfaces downstream effect (commission/receipt linkage).
7. **[P2] (g) Attendance marking.** `attendance-panel.tsx`/`attendance-roster.tsx` unreferenced. Add: open class session, mark present/absent, save, assert persistence on reload.
8. **[P2] (h) Payroll computation.** `admin-hr-panel.spec.ts:23-30` only asserts roster render. Add: trigger payroll run for a period, assert computed salary/commission lines; optionally verify "Phiếu lương của tôi" (`my-payslips-panel`).

### B-staleness / infra risks
- **[low] loginCode comment stale:** `lms-smoke.spec.ts:6-7` seeds `STUDENT_CODE='TEST-001'`, but loginCodes are now facility-prefixed (`HQ-HS-2026-0042`). Confirm the smoke seed still emits `TEST-001` (fixed seed) or update fallback/comment to the prefixed format.
- **[low] No deterministic seed / flakiness:** `playwright.config.ts` = `fullyParallel:false, retries:0`, one chromium project, default creds `admin@cmc.local/ChangeMe!123`. No documented seed step guarantees super_admin + director + finance-eligible parent phone + LMS student fixtures before E2E. Add a global-setup/seed command before the flows above; consider `retries:1` in CI for network-bound provisioning.

---

## C. Frontend thừa/thiếu/hỏng (gỡ-sửa)

### C1 [medium] Unused `Select` import breaks the admin lint gate (RED)
- Evidence: `apps/admin/src/payroll-panel.tsx:13` imports `Select` from `@mantine/core`; only `selected/onSelect/setSelected` used. This is the single error from `pnpm --filter @cmc/admin lint` (`@typescript-eslint/no-unused-vars`) → lint exits 1. Not introduced tonight (last touched 61dcf8c) but currently red.
- Fix: Remove `Select,` from the `@mantine/core` import at `payroll-panel.tsx:13`.

### C2 [medium] kpiOverride ("Điều chỉnh KPI") referenced but NOT wired in admin UI
- Evidence: `kpi-evaluation-panel.tsx:162-163` comment directs users to "Điều chỉnh KPI" (kpiOverride); `NumberInput` is `disabled={row.status !== 'draft'}` (`:216`). But no `payroll.kpiOverride` call anywhere in `apps/admin/src/*.tsx`; procedure exists only server-side (`payroll.ts:1073`). After a sheet leaves draft there is no in-app path to adjust a score.
- Fix: Add an "Điều chỉnh KPI" action (with reason input) in `kpi-evaluation-panel.tsx` calling `payroll.kpiOverride` — OR remove the comment if override is intentionally CLI/back-office only. (This also blocks E2E item B3 and contradicts the doc which implies score-adjustment exists.)

### C3 [low] Stale `scores?` param on client `kpiEvalConfirm` type
- Evidence: `kpi-evaluation-panel.tsx:56` declares `kpiEvalConfirm.mutate(i: { userId; periodKey; scores?: ScoreEntry[] })`, but `doConfirm()` (`:164`) calls `{ userId, periodKey }` with no scores; server schema accepts only userId+periodKey (`payroll.ts:833-839`). Dead/misleading field.
- Fix: Drop `scores?: ScoreEntry[]` from the `kpiEvalConfirm` signature at `:56`.

### C4 [low] Hidden certificate panel still reachable via URL hash
- Evidence: `shell.tsx:379` sets certificate nav `visible:false`, but `App.tsx` still imports `CertificatePanel` (`:52`), keeps `'certificate'` in `ALL_SECTION_KEYS` (`:563`, feeds `hashToSection` `:566-568`), and routes it (case `'certificate'`, `:690`). Navigating to `#certificate` still renders the hidden panel. Intentional retention per `shell.tsx:380` comment, but the hash route wasn't gated.
- Fix: To fully hide, remove `'certificate'` from `ALL_SECTION_KEYS` (`App.tsx:563`) or gate the case behind nav visibility. Otherwise accept the hash exposure (server procedures stay permission-gated). Low risk — decision, not a bug.

### C-POSITIVE
- Tonight's password-drop cleanup in `App.tsx` is complete/correct: `PasswordInput` import + password field/validation fully gone; `minLength` still legitimately used for course/facility codes; `pnpm --filter @cmc/admin typecheck` passes clean.

---

## Fix-list ưu tiên

### P0 — block release / gate red
- **C1** Remove unused `Select` import (`payroll-panel.tsx:13`) — admin lint currently exits 1.
- **B1** Add E2E for receipt-approve → student + facility-prefixed LMS provisioning (core revenue path).
- **B2** Add E2E for SSO-only create-staff incl. regression guard "no Mật khẩu field".

### P1 — correctness / coverage of tonight's changes
- **C2** Wire `kpiOverride` ("Điều chỉnh KPI") UI, or delete the dangling comment (also unblocks B3 + reconciles A3/doc).
- **A1** Reconcile certificate: re-enable nav OR mark all doc refs "tạm ẩn" (both guides).
- **A3** Fix sale/GV guide: KPI self-submit is HR/manager-mediated, no self-serve menu.
- **B3** E2E: director KPI confirm/approve + read-only scores + override-blocked-after-approval (needs C2).
- **B4** E2E: LMS homework submit → grading → grade view (seed dev OTP).
- **B5** E2E: staff login fail-closed for non-super_admin.

### P2 — hygiene / lower-traffic flows
- **A2** Director guide: note open read-only sections visible to all staff.
- **A4** Remove/flag badge section (no frontend).
- **A5** Reword "Duyệt cấp độ" — propose lives in Học bạ.
- **A6** Document directors' resetLmsPassword + verify reachability (Học sinh panel gated away).
- **A7** Add "Vai trò chính" to create-user doc step.
- **C3** Drop stale `scores?` from `kpiEvalConfirm` type.
- **C4** Decide on `#certificate` hash route gating.
- **B6/B7/B8** E2E for CRM pipeline, attendance, payroll compute.
- **B-infra** Deterministic E2E seed/global-setup; `retries:1` in CI; confirm `TEST-001` smoke seed vs facility-prefix.

## Unresolved questions
1. **C2 vs A-positive tension:** Is `kpiOverride` meant to be in-app (Quản Lý/tree-manager UI) or CLI/back-office only? Determines whether C2 is "wire it" or "delete comment + doc note", and whether B3 is testable via UI.
2. **A1 direction:** Re-enable certificate, or keep hidden? Drives whether docs get edited or the nav flag flips.
3. **A6 reachability:** Should directors actually be able to reset LMS passwords given the Học sinh panel is gated to quan_ly/sale? If yes, the panel needs a director-visible entry point; if no, the permission grant is over-broad.
