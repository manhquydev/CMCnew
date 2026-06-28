# QA Tổng hợp — Audit Yêu cầu 10 Domain (CMCnew)

- Ngày: 2026-06-27 21:09
- Vai trò: Lead QA (tổng hợp 10 audit độc lập, READ-ONLY)
- Phạm vi: Đối chiếu implementation thật với yêu cầu, theo hướng đối kháng. Không chạy `*.int.test.ts` (shared dev DB localhost:5433). Bằng chứng trích `file:line` từ các audit con.
- Ràng buộc xác minh: Mọi kết luận runtime (RLS chặn cross-facility, double-approve race, OIDC round-trip, behavior workflow trên DB) đều suy ra từ đọc code + migration SQL + unit/typecheck, KHÔNG chạy live. Xem mục "Không xác minh được" cuối báo cáo.

---

## 1. Tóm tắt điều hành

- 0 domain ĐẠT hoàn toàn. 9/10 **PARTIAL**, 1/10 (**finance-provisioning**) tổng trạng thái **BUG** vì có lỗi `high` chặn đường tiền cốt lõi.
- Không có finding `critical`. Có **4 finding `high`** (2 về mật khẩu nhân sự/SSO, 1 finance loginCode collision, 1 payroll KPI chưa gate `approved`).
- **Chủ đề rủi ro lớn nhất xuyên suốt: nhân sự KHÔNG bị ép 100% SSO.** Hệ vẫn bắt nhập mật khẩu khi tạo staff và vẫn cho đăng nhập bằng mật khẩu cho mọi vai trò khi cấu hình SSO chưa đủ. Đây là mâu thuẫn thiết kế + lỗ hổng bảo mật (chi tiết §2).
- Mẫu lỗi lặp lại: (a) thiếu state-gate trước khi mutate (KPI override sau approve, opportunity rời O5, testGrade re-grade, submission.save sau submit); (b) unique key toàn cục đụng với mô hình facility-scoped (loginCode, parent phone) gây P2002 rollback; (c) facilityId tin client thay vì derive server (schedule.addSlot).

---

## 2. An toàn đăng nhập nhân sự — KẾT LUẬN DỨT KHOÁT

**Hệ thống hiện KHÔNG ép nhân sự 100% SSO. Vẫn TẠO và ĐĂNG NHẬP được bằng mật khẩu.** Mô hình "100% SSO, password chỉ break-glass cho super_admin" mới chỉ là tài liệu, chưa được enforce trong code.

Bằng chứng:

1. **Bắt buộc nhập password khi tạo staff** (mâu thuẫn mô hình SSO-only):
   - API: `apps/api/src/routers/user.ts:82` (`password: z.string().min(8)`) và `user.ts:130` (`passwordHash: await hashPassword(input.password)`).
   - UI: `apps/admin/.../App.tsx:289,292,334-337` (PasswordInput `withAsterisk`, validate min 8).
   - Trái với `docs/auth-sso-otp-redirection.md:16-17` ("No staff passwords managed by ERP except break-glass super_admin") và chính comment `user.ts:145-146` ("SSO onboarding: no password is sent").
   - `AppUser.passwordHash` là **NOT NULL** (`schema.prisma:105`) → gốc rễ buộc form phải bịa mật khẩu (khác `ParentAccount.passwordHash` đã nullable).

2. **Password do giám đốc đặt là credential đăng nhập THẬT khi SSO chưa bật đủ** (cửa sổ pre-config / env-drift):
   - Chặn break-glass chỉ kích hoạt khi `SSO_ENABLED==='true' AND ssoConfigFromEnv() != null AND !isSuperAdmin` (`apps/api/src/routers/auth.ts:34`).
   - `ssoConfigFromEnv()` trả `null` trừ khi đủ TẤT CẢ `ENTRA_*`/redirect/emailDomain (`sso.ts:20-28`); `ENTRA_CLIENT_SECRET` "supplied later by IT; unset = SSO disabled" (`docs/auth-sso-otp-redirection.md:134`).
   - `login()` (`packages/auth/src/index.ts:53-61`) verify password cho MỌI role. → Trong cửa sổ chưa cấu hình SSO, mọi tài khoản staff giám đốc tạo đều có password đăng nhập được, và giám đốc biết password đó.
   - Mặc định **fail-OPEN**: password login bật sẵn cho tới khi SSO wired đầy đủ.

3. **mintStaffSession (đường SSO) KHÔNG bao giờ đọc passwordHash** (`packages/auth/src/index.ts:77-91`) — xác nhận password lưu trữ là "thừa" với SSO, nhưng vẫn là cửa đăng nhập song song qua `login()`.

Khuyến nghị (gộp finding auth-sso + user-onboarding):
- **Fail-closed**: chặn password login cho non-super_admin theo allow-list tường minh, KHÔNG phụ thuộc sự hiện diện của SSO config.
- Bỏ thu thập password ở form tạo staff; làm `AppUser.passwordHash` nullable; tạo staff với hash=null (hoặc random server-side); `login()` coi hash null = "password login unavailable" (giống `loginParent` lms.ts:89-90).
- Khi `SSO_ENABLED=true` nhưng config thiếu: log cảnh báo to + vẫn fail-closed thay vì mở password cho toàn bộ staff.
- Cập nhật `docs/huong-dan-su-dung-giam-doc.md:226-231` cho khớp form sau khi bỏ password (hiện hướng dẫn không có bước password → giám đốc không submit được form thật).

---

## 3. Bảng tổng quan trạng thái 10 domain

| # | Domain | Trạng thái | High | Med | Low | Điểm nóng nhất |
|---|--------|-----------|------|-----|-----|----------------|
| 1 | auth-sso | PARTIAL | 0 | 2 | 3 | SSO_ENABLED=true đơn lẻ không chặn password; email case mismatch lockout |
| 2 | rbac-permissions | PARTIAL | 0 | 1 | 2 | test nav-consistency D4 đang RED (stale assertion) |
| 3 | crm-sale | PARTIAL | 0 | 3 | 2 | transition regress WON; thiếu invariant 1-opp/1-SĐT; leadIngest không rate-limit |
| 4 | finance-provisioning | **BUG** | 1 | 0 | 3 | loginCode collision cross-facility → rollback approve (đường tiền) |
| 5 | payroll-kpi | PARTIAL | 1 | 2 | 2 | điểm KPI feed payslip không gate `approved`; confirm bỏ qua scores |
| 6 | lms | PARTIAL | 0 | 1 | 1 | submission.save trả grade chưa redact (lộ điểm chưa publish) |
| 7 | attendance-schedule | PARTIAL | 0 | 2 | 2 | addSlot tin facilityId client; guard mark chéo lớp/cơ sở không có test |
| 8 | assessment-grade | PARTIAL | 0 | 1 | 6 | termUpdate thiếu validate start<=end; passMark client-supplied |
| 9 | email-notifications | PARTIAL | 0 | 2 | 3 | lưu plaintext temp password vĩnh viễn trong email_outbox.body_html |
| 10 | user-onboarding | PARTIAL | 2 | 2 | 1 | form ép password (mâu thuẫn SSO); password = credential thật khi SSO off |

ĐẠT (no finding) ở cấp domain: không có. Tất cả đều có whatWorks mạnh nhưng còn gap → PARTIAL trở lên.

---

## 4. Findings xếp theo severity (đã gộp trùng)

### HIGH

**H1 — Nhân sự không bị ép SSO; password vẫn là credential thật** *(gộp: user-onboarding finding1+2, auth-sso "SSO_ENABLED không chặn password")*
- Kind: bug + security. Chi tiết & bằng chứng: §2.
- Tác động: giám đốc có thể đăng nhập như nhân sự mình tạo; password yếu/chia sẻ lọt trust boundary trong cửa sổ pre-config.

**H2 — finance: loginCode đụng cross-facility làm rollback toàn bộ receipt.approve** *(finance bug, đường tiền)*
- `finance.ts:525` đặt `loginCode = student.studentCode`; studentCode đã facility-scoped (`schema.prisma:186`, migration 20260627070000) NHƯNG `student_account.login_code` vẫn UNIQUE TOÀN CỤC (migration 20260623090658:183; `schema.prisma:472`).
- Hai cơ sở cùng đánh số 1..N → cơ sở thứ 2 approve HS mới thứ N đụng unique tại `studentAccount.create` (finance.ts:522); vì trong cùng transaction → rollback cả voucher consume + student + enrollment, ném P2002 thô. Đường tiền cốt lõi fail.
- Lưu ý: report cũ (code-review-260627-1024) coi là latent đã hết hiệu lực sau commit 65768d8 — abort dời xuống studentAccount.create và nay reachable.
- Fix: login_code unique per-facility, hoặc nhúng facility vào loginCode/studentCode, hoặc index `(facility_id, login_code)`.

**H3 — payroll: điểm KPI feed vào payslip KHÔNG gate theo status `approved`** *(payroll gap)*
- `assembleSlipData` đọc `overrideScore ?? autoScore` không lọc status (`payroll.ts:114-118`); `payslipCompute` gọi trực tiếp (`:363`). Spec/UI: "khi phê duyet diem khoa lai moi do vao luong" (decision 0011:48-53; kpi-evaluation-panel.tsx:377-378).
- Tác động: HR chạy payslipCompute khi KPI còn draft/submitted → dùng điểm chưa duyệt (draft autoScore=0 làm mất kpiBonus, hoặc submitted chưa qua confirm/approve vẫn vào lương).
- Fix: chỉ nhận điểm khi `row.status==='approved'`.

> Hai finding `high` H1 và H2/H3 độc lập nhau; H1 là chủ đề bảo mật, H2 chặn nghiệp vụ tiền, H3 sai dữ liệu lương.

### MEDIUM

- **M1 (email) — Lưu plaintext temp password LMS vĩnh viễn** trong `email_outbox.body_html` (email-templates.ts:73 comment sai "never stored"; render tại enqueue, không scrub sau sent/failed; finance.ts:544-556). Giảm nhẹ bởi RLS super-only. Fix: scrub bodyHtml sau sent/failed hoặc render lazy ở worker.
- **M2 (auth-sso) — Email case mismatch khóa nhầm user SSO đã provision**: redeemCode lowercase email (sso.ts:92) + findUnique case-sensitive (auth/index.ts:80-82) nhưng `user.create` lưu email không normalize (user.ts:128), cột unique case-sensitive (schema.prisma:102). Latent (dev data toàn lowercase) nhưng bất kỳ email mixed-case → not_provisioned. Fix: normalize lowercase lúc ghi + lookup.
- **M3 (rbac) — Test nav-consistency D4 đang RED**: assert `NAV_GATES.org.kind==='superAdmin'` (nav-consistency.test.ts:114-124) nhưng impl cố ý là `permission/user.create` để director thấy org panel (nav-permissions.ts:43). Impl ĐÚNG (security vẫn giữ), test STALE → sẽ chặn/should-chặn CI. Fix: cập nhật test.
- **M4 (crm) — opportunityTransition regress được deal WON (O5+closedAt)** không guard (crm.ts:164-186), trái với markLost tự bảo vệ (crm.ts:194-197). Won/enrolled/commissioned có thể lùi về O2, clear closedAt, không đảo receipt/enrollment. Fix: thêm won-deal guard.
- **M5 (crm) — Thiếu invariant "1 opportunity = 1 HS/SĐT"** (gap): opportunityCreate + leadIngest tạo opp mới mỗi lần, không check open opp trùng (contactId, studentName); leadIngest lặp → stack O1 trùng. Fix: reuse open opp hoặc partial unique index.
- **M6 (crm) — leadIngest public không rate-limit + so token không constant-time** (security): spec yêu cầu rate-limited (phase-03:88) nhưng chỉ `input.token !== expected` (crm.ts:369). Token lộ → spam contact/opportunity. Fix: per-IP/per-facility rate limit + constant-time compare + per-facility token.
- **M7 (payroll) — Manager chỉnh điểm ở bước Confirm bị âm thầm bỏ qua** (bug): UI gửi `{userId,periodKey,scores}` nhưng router kpiEvalConfirm chỉ nhận `{userId,periodKey}`, Zod strip `scores` → chỉnh sửa mất, approve recompute từ điểm submit cũ (payroll.ts:830-859; panel:159-168). Fix: cho confirm nhận scores (qua canOverrideKpi) hoặc bỏ input scores khỏi UI.
- **M8 (payroll) — kpiOverride không gate status → sửa được phiếu đã `approved`** (gap): không check row.status (payroll.ts:1070-1121); overrideScore mới vào lương không qua lại SoD. UI disable tạo cảm giác khóa nhưng endpoint vẫn mutate. Fix: chặn override khi approved hoặc yêu cầu reopen.
- **M9 (attendance) — schedule.addSlot tin facilityId client, không derive từ batch** (security): addSlot nhận `facilityId` từ input, create không load classBatch (schedule.ts:23-51), lệch pattern server-derive của attendance/generateSessions. RLS WITH CHECK không chặn mismatch khi user pass facility mình + classBatchId cơ sở khác (FK chạy as owner) → slot mồ côi. Fix: derive facilityId từ classBatch như attendance.mark.
- **M10 (attendance) — Guard chống mark chéo lớp/cơ sở KHÔNG có test** (untested): invariant an ninh cốt lõi (attendance.ts:47-52) không có assertion nào. Fix: thêm int test cross-class/cross-facility/spoofed-facilityId.
- **M11 (assessment) — termUpdate thiếu validate start<=end** (bug): termCreate có refine (assessment.ts:60), termUpdate không (77-97) → admin PATCH start>end tạo window đảo, zero hóa toàn bộ grade/attendance, FinalGrade incomplete âm thầm. Fix: thêm refine/validate window.
- **M12 (user-onboarding) — Phone/SĐT staff không bao giờ thu thập** dù `AppUser.phone` tồn tại (schema.prisma:103): input/create/form đều thiếu. Quyết định: thêm field optional hoặc bỏ cột chết.
- **M13 (user-onboarding) — Guide giám đốc không theo được form thật** (ux): doc liệt kê Email/Tên/Vai trò/Cơ sở, không có password; form thật bắt password required → giám đốc không submit được. Tự khớp sau khi xử lý H1.
- **M14 (email) — Test no-op (Graph chưa cấu hình) phụ thuộc env, fail khi ENTRA_* set** (bug): test chỉ xóa GRAPH_* không xóa ENTRA_* (email-graph-client.test.ts:24-30), graphMailerFromEnv fallback ENTRA_* → trả config thay vì null, và **đã dump client secret ra stdout**. Đảm bảo "ships inert" không được phủ tin cậy. Fix: xóa cả ENTRA_*/GRAPH_CLIENT_SECRET/GRAPH_SENDER_* trong test.
- **M15 (lms) — submission.save trả grade CHƯA redact** (security): save trả `submissionSelect` gồm grade.score+feedback (submission.ts:141-147,21-31) nhưng KHÔNG qua redactUnpublishedGrade (khác mine/forStudent). HS có điểm chưa publish gọi lại save → nhận raw score+feedback trước khi GV publish. Fix: redact hoặc bỏ grade khỏi select của save.

### LOW (chọn lọc, gộp theo nhóm)

- **Auth-sso**: thiếu nonce trong authorize URL (chấp nhận với PKCE+state); tenant pin bỏ qua khi thiếu `tid` (đã pin bởi authority single-tenant); SSO callback cookie host-only → dev split-origin không nhận (prod OK).
- **RBAC**: director thấy nút org-panel mutation (setRoles/setActive/setFacilities) mà backend reject → dead-end UX; registry có super_admin-only rows never consulted by can() (doc-only, vô hại).
- **CRM**: opportunityTransition không validate sequence (cho phép nhảy O1→O5 mark won bỏ qua test/enrollment); testGrade re-grade appointment đã 'done' ghi đè điểm/grader cũ.
- **Finance**: parent-phone dedupe findFirst-then-create đụng global unique → P2002 khi concurrent (fail-safe); LMS account KHÔNG provision cho HS dedupe-match/renewal (design choice, cần xác nhận product); audit body lỗi chữ "dari phiếu" (cosmetic).
- **Payroll**: kpiEvalApprove không check tree-authority approver↔target (v1 chấp nhận theo decision 0011); budget cap <=6% chỉ ở preview không cảnh báo ở auto-feed payslip.
- **LMS**: submission.save không có status-guard → sửa answer sau submit/grade (cũng là điều kiện kích hoạt M15).
- **Attendance**: addSlot không validate room/teacher cùng cơ sở; attendance.mark không check enrollment active / session cancelled.
- **Assessment**: grade dùng `gradedAt` còn attendance dùng `sessionDate` (lệch trục thời gian); Grade.maxScore không refresh khi regrade nếu exercise.maxScore đổi; term lock không chặn raw grade.grade/publish (by-design, raw drift khỏi FinalGrade đã freeze); passMark client-supplied (grader gửi 0 cho pass tất cả); certificate.issue không check FinalGrade.passed + không có endpoint revoke/archive; levelProgress.propose cho toLevel==fromLevel.
- **Email**: poison-pill loop (lease reclaim không tăng attempts → crash mid-send retry mãi); lms_account_ready dedupKey chỉ theo studentId chặn re-provision hợp lệ; parent-meeting reminder N+1 query.
- **User-onboarding**: AppUser.passwordHash NOT NULL trong khi auth model coi password staff optional (gốc rễ H1).

---

## 5. Danh sách hành động đề xuất (xếp ưu tiên)

**P0 — chặn ship / rủi ro cao**
1. **[H1] Ép fail-closed SSO cho nhân sự**: bỏ password ở form tạo staff, `AppUser.passwordHash` nullable, chặn password login non-super_admin bất kể SSO config; cập nhật guide. (auth.ts, user.ts, App.tsx, schema, docs)
2. **[H2] Sửa loginCode unique cho finance**: per-facility hoặc index `(facility_id, login_code)` — chặn rollback đường tiền multi-facility. (migration + schema.prisma:472)
3. **[H3] Gate điểm KPI feed payslip theo status `approved`** trong assembleSlipData. (payroll.ts)

**P1 — đúng đắn dữ liệu / bảo mật**
4. [M1] Scrub plaintext password trong email_outbox.body_html sau sent/failed.
5. [M4] Thêm won-deal guard cho opportunityTransition.
6. [M6] Rate-limit + constant-time token cho leadIngest.
7. [M7]/[M8] Nối đường chỉnh điểm Confirm + gate kpiOverride theo status.
8. [M9] Derive facilityId từ classBatch trong schedule.addSlot.
9. [M11] Validate start<=end ở termUpdate.
10. [M15] Redact grade trong submission.save + thêm status-guard.
11. [M2] Normalize email lowercase lúc ghi + lookup (chặn lockout SSO).
12. [M14] Sửa test no-op email để không leak secret + phủ đúng "ships inert".

**P2 — invariant / test / UX**
13. [M3]/[M10] Cập nhật test nav-consistency D4 (stale) + bổ sung int test guard mark chéo lớp/cơ sở (xanh CI).
14. [M5] Enforce invariant 1-opp/1-SĐT (reuse open opp hoặc partial unique).
15. [M12]/[M13] Quyết định phone staff (thêm field hoặc bỏ cột) + đồng bộ guide giám đốc.
16. Low items: passMark từ template thay client; certificate.archive/revoke + check passed; refresh Grade.maxScore khi regrade; poison-pill attempts++; per-facility room/teacher validation.

---

## 6. Không xác minh được (chung toàn audit)

- **Runtime trên DB**: mọi `*.int.test.ts` (RLS cross-facility, double-approve race, term-lock, KPI multi-actor, email idempotency/backoff, OTP) bị cấm chạy do shared dev DB. Kết luận RLS/race suy từ đọc migration SQL + code path + advisory-lock reasoning, KHÔNG chạy live.
- **SSO live**: OIDC round-trip Microsoft (authorize→callback, id_token claims, iss/aud/tid enforcement bởi MSAL) không chạy được — R6 pending, ENTRA_CLIENT_SECRET unset (SSO no-op 503). Chỉ unit-test helper thuần.
- **Graph email delivery**: env này gửi thất bại (rows status=failed); không quan sát được 202 thật, chỉ logic mock-fetch.
- **SSE end-to-end** (browser delivery) và **nginx /api prefix** (Set-Cookie/redirect thật) chỉ suy từ code, không exercise.
- **Prod env values** (SSO_ENABLED, ENTRA_CLIENT_SECRET) và **số cơ sở live thực tế** không kiểm tra được — cửa sổ khai thác H1 và reachability H2 phụ thuộc các giá trị này.
- **Charter nghiệp vụ grading** (passMark, certificate-without-pass) không có doc dưới docs/ để đối chiếu — chỉ assert trong comment + unit test.

---

## 7. Câu hỏi mở cho product/owner

1. Có chốt fail-closed SSO ngay (bỏ password staff hoàn toàn) hay giữ break-glass password rộng hơn super_admin trong giai đoạn pre-config?
2. login_code/studentCode: nhúng facility hay chỉ đổi unique scope? Ảnh hưởng định dạng mã HS hiển thị.
3. KPI: cho phép override sau `approved` (đường điều chỉnh có audit) hay khóa cứng?
4. Director có được quản lý tài khoản hiện hữu (setRoles/setActive) không? Quyết định ẩn nút hay mở quyền.
5. Renewal/dedupe-match có cần tạo StudentAccount LMS lúc approve không, hay giữ on-demand?
6. passMark và certificate có phải ràng theo FinalGrade.passed/template không?
