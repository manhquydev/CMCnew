# Brainstorm — Bản đồ độ-hoàn-thiện toàn dự án → Plan 4-7

Date: 2026-07-02 · Branch: develop · Input: 4 scout song song (tài chính vòng ngoài, giáo vụ residual, học bạ/thưởng/LMS residual, sổ nợ+ops) + 1 vòng hỏi-đáp.
Bổ trợ cho: Plan 1 `260702-0929-lms-erp-seam-fixes`, Plan 2 `260702-1007-lms-homework-pdf-completion`, Plan 3 `260702-1030-role-flows-completion` (KHÔNG trùng phạm vi — mọi mục dưới đây nằm ngoài 3 plan đó).

## Quyết định operator (2026-07-02, FINAL)
- **D-P4a Hoàn tiền**: sổ hoàn tiền GHI TAY — bản ghi refund (số tiền + lý do + người trả + audit) gắn phiếu hủy; GĐ tự tính số tiền. Pro-rata tự động = DEBT chờ chính sách.
- **D-P5a Điểm cuối kỳ**: GIỮ TỨC-THÌ — computeFinalGrade = công bố (đã có term-lock); không thêm cổng duyệt.
- **D-Split**: duyệt cả 4 plan P4-P7, thứ tự khuyến nghị P7 ops sớm → P4/P5 → P6.
- Tự quyết (orchestrator): plan `260701-1223-lms-climb-session-lock` → **SUPERSEDED** bởi cơ chế auto-open Plan 1 (đóng, ghi chú); tenancy `course` global → chốt trong Decision A Plan 1; afterSale-cho-sale gộp ADR 0027; "GĐ đọc payroll toàn cơ sở" DEBT → đã đóng bởi Decision B Plan 3; leaderboard facility/seasonal + MAES (chờ công thức từ operator) + pro-rata → DEBT.

## PLAN 4 — Tài chính vận hành (💰 HIGH-RISK: tiền + audit)
Nguồn: scout finance outer-ring. Anchors verified:
1. **Sổ hoàn tiền** (impact #1): `finance.receiptCancel` (`finance.ts:737-844`) chỉ đổi trạng thái + rollback; KHÔNG ghi nhận tiền ra. Thêm model RefundRecord (receiptId, amount, reason, paidById, createdAt) + UI trong luồng hủy + audit. Ghi tay theo D-P4a.
2. **Email ops**: engine outbox tốt (`email-outbox.ts` — 5-attempt backoff, dedupKey, cron drain `index.ts:407-413`) nhưng KHÔNG có surface admin đọc `emailOutbox` (grep 0) → màn xem pending/failed + retry (lưu ý: body chứa secret bị scrub khi terminal-fail — retry `lms_account_ready` chết phải re-provision, hiển thị cảnh báo). Thêm template kind `receipt` (kinds hiện tại `email-templates.ts:5-10` không có) + nút gửi phiếu qua email. Vá notif chết: `finance.ts:281-291` receiptCreate bắn cho role `ke_toan` không ai giữ → đổi sang GĐKD.
3. **Báo cáo doanh thu**: chỉ có `dashboard.summary` revenueTotal all-time (`dashboard.ts:148-178`) → báo cáo tháng/cơ sở/khóa + xuất CSV.
4. **Đối soát theo kỳ**: hiện chỉ per-receipt flip (`finance.ts:702`, UI `finance-panel.tsx:592-596`) → worklist "chưa đối soát kỳ này".
5. **UI bậc giảm giá**: per-facility `discountTier` được đọc (`finance.ts:32-36`) nhưng không UI tạo/sửa → hardcode DEFAULT 15/20/30 (`@cmc/domain-finance`). UI config + giữ trần 35%.
- Vững sẵn (không đụng): voucher engine (`finance.ts:322-332`), CoursePrice, receipt state machine. Dead perm duy nhất: `compensation.effective`.

## PLAN 5 — Giáo vụ vận hành (🏫 HIGH-RISK: data model enrollment/attendance)
Nguồn: scout academic residual + học bạ PDF từ scout assessment. Anchors verified:
1. **Chuyển lớp** (month-1 #1): không có mutation transfer; `EnrollmentStatus.transferred` không bao giờ set (chỉ đọc phòng vệ `attendance.ts:60`); drop+re-enroll làm mất mạch attendance/grades (key theo enrollmentId). Cần: enrollment.transfer (old→transferred + new enrollment cùng student, giữ lịch sử, chatter log, LMS liền mạch).
2. **Buổi học bù**: `isMakeup` hoàn toàn dormant (chỉ được đọc `curriculum-recompute.ts:30`, không nơi nào ghi true; không endpoint tạo session đơn lẻ trong `schedule.ts`). Cần: createMakeupSession (date/time/room/teacher, isMakeup=true, reuse detectConflicts, loại khỏi recompute — đã sẵn, roster điểm danh).
3. **Điểm danh**: không bulk mark-all (`attendance-roster.tsx` từng học sinh — ma sát hằng ngày); không báo cáo theo học sinh/lớp/kỳ (chỉ `listBySession`); parent chỉ thấy aggregate rate (`parent-view.tsx:509`).
4. **Học bạ + chứng chỉ PDF & LMS** (chung hạ tầng render): học bạ on-screen có (`parent-view.tsx:407+`) nhưng KHÔNG export/PDF; chứng chỉ staff-only HTML (`index.ts:202`), LMS không có endpoint xem → parent thấy + tải PDF cả hai.
5. **Lifecycle enforcement**: `setStudentLifecycle` không tự tác động gì — học sinh withdrawn/paused vẫn full LMS access (`lms-auth.ts` không gate) + attendance chỉ chặn theo enrollment.status. Cần: lifecycle → khóa LMS login + chặn điểm danh + hiển thị trạng thái.
6. **Nối nốt UI**: `room.update/archive` (`room.ts:37,61` — API xong, 0 UI), `parentMeeting.setSchedule` (`parent-meeting.ts:50` — chốt giờ TBD mà PH đang nhìn thấy qua myMeetings). Ghi outcome/note cuộc họp (schema có `note`, UI không ghi).
7. Capacity: GIỮ soft-warning (đã có `enrollment.ts:126` + UI ⚠) — không chặn cứng (quyết KISS).
- Mở: "excused" là checkbox modifier (schema) chứ không phải trạng thái thứ 4 — giữ nguyên thiết kế hiện tại, note trong plan.

## PLAN 6 — LMS gắn kết & quản trị thưởng (🏅 normal-strong)
Nguồn: scout assessment/rewards. Anchors verified:
1. **Notif "bài tập mới mở" cho học sinh**: `exercise.ts` không tạo notification khi mở. Với auto-open query-time của Plan 1, cần cron quét ClassSession vừa kết thúc (node-cron sẵn) → emit notification cho học sinh lớp đó khi unit có exercise published; idempotent theo (sessionId). PHỤ THUỘC Plan 1 shape.
2. **Quản trị quà + sao**: chỉ có `giftCreate` (`rewards.ts:17-49`); không giftUpdate/giftArchive/stock-adjust; không endpoint điều chỉnh sao thủ công (sao chỉ chạy qua publish/redeem/refund — nhập sai là chịu). Redeem approved là terminal — thêm trạng thái delivered (nhẹ).
3. **Badge admin UI**: `badge.ts:35-160` API đủ (list/create/archive/grant), 0 UI admin — dựng màn quản trị + grant tay (GĐ đào tạo + GV grant theo perm hiện có).
4. **Parent self-service**: đổi thông tin hồ sơ PH + tự liên kết thêm con (hiện `guardian.link/parentCreate` staff-only `guardian.ts:22,66`) — thiết kế an toàn: PH yêu cầu link bằng SĐT/mã học sinh → staff duyệt (không tự link thẳng, chống chiếm đoạt).
5. Polish: nhãn notif `parent_meeting_reminder` rơi vào "Thông báo mới" chung (`parent-view.tsx:235`).
- DEBT: leaderboard toàn cơ sở, seasonal reset, student change-password (student login bằng loginCode+password cấp phát — đổi mật khẩu cần thiết kế riêng, ghi DEBT).

## PLAN 7 — Ops hardening (🛡️ infra lane — làm SỚM nhất)
Nguồn: scout debt/ops. Anchors verified:
1. **Error tracking/monitoring**: 0 Sentry/pino/OTEL trong `apps/api/src`; chỉ console + `/health` marker (`index.ts:48-54`). Cần: structured logging (pino) + error tracking (Sentry self-host hoặc SaaS free tier — planner chọn) + alert cơ bản (email qua outbox khi error rate).
2. **Backup**: `scripts/backup-db.sh` (+ bản trùng `db-backup.sh`, `db-restore.sh`) tồn tại, runbook §5 ghi daily cron nhưng KHÔNG được cài trong deploy scripts → cài cron trên VPS qua compose/host + diễn tập restore có biên bản; dedupe 2 script trùng.
3. **CI trên PR**: `Jenkinsfile:23-80` — PR chỉ Lint+Typecheck; Integration/Build/Smoke gate `branch 'main'`; không e2e stage. Cần: int-test chạy trên PR (DB service trong pipeline), cân nhắc e2e smoke.
4. **Lint guard RLS**: cấm import raw `prisma` ngoài whitelist (ESLint no-restricted-imports) — chặn bypass `withRls` tương lai.
5. **Dọn tài liệu/trạng thái stale**: roadmap ⬜ session-evidence (đã ship 3d6db9d), TEST_MATRIX LMS-SESSION-EVIDENCE planned→implemented; plan statuses: hr-role-consolidation (shipped 27849d3), teacher-nav (e2e fixed 26dc955), 260626 prod-readiness ×2 → superseded-by-260628; climb-session-lock → superseded-by-Plan-1; DEBT.md sync (đóng mục payroll-director-read theo Decision B P3; thêm mục mới từ hôm nay). Env docs: thêm `STAFF_PASSWORD_LOGIN`, `DISABLE_CRON` (+8 rate-limit/store vars) vào `.env.example` kèm chú thích.
- Note coverage: 0 unit test toàn matrix, e2e ≈ 1 file thật — CI-on-PR là bước 1; nâng coverage là chuyện dài hơi (không nhồi plan này).

## Thứ tự & phụ thuộc toàn pipeline
```
Plan 1 seam-fixes ──► Plan 2 LMS-PDF ∥ Plan 3 role-flows
Plan 7 ops: độc lập code sản phẩm — chạy SỚM (trước/song song Plan 1, khác file)
Plan 4 tài chính: sau Plan 3 (chung finance-panel/permissions? P3 đụng finance-panel opportunityId — serialize)
Plan 5 giáo vụ: sau Plan 1 (schedule/session shape) — có thể ∥ Plan 4
Plan 6 LMS/thưởng: sau Plan 1 (exercise shape) + sau Plan 2 (LMS files) — cuối
```

## Success criteria tổng (go-live readiness)
1. Tiền: mọi đồng ra-vào có bản ghi (phiếu thu + sổ hoàn); email phiếu/tài khoản lỗi là thấy + retry được; báo cáo tháng xuất được.
2. Trường: chuyển lớp/học bù không mất lịch sử; cô điểm danh 1 chạm; PH tải được học bạ/chứng chỉ PDF.
3. Gia đình: học sinh được báo khi bài mở; sao/quà sửa được khi sai.
4. Vận hành: lỗi prod có alert; backup chạy tự động + restore đã diễn tập; PR không qua được nếu int-test đỏ.

## Unresolved
- Không còn ở mức brainstorm. Chi tiết (chọn công cụ monitoring, shape RefundRecord, cron notif idempotency) để các planner quyết.
