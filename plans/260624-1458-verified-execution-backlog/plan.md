# Plan — Backlog có thứ tự sau review (verify từng việc)

> Lập 2026-06-24 sau khi: rà soát thật 5 đầu việc treo + chạy 2 agent code-review.
> Nguyên tắc thực thi (chủ dự án chốt): **làm tuần tự · verify từng việc bằng bằng chứng thật · không "xong là xác nhận" · việc rủi ro chạy 2-agent review trước khi đóng.**

## Tổng hợp review (2 agent, đã controller-verify)
- ✅ **Lưới integration test "có răng" thật** — caller thật + DB thật + RLS thật, đọc lại state từ DB, có mutation-proof. Không đụng `apps/api/src` (0 hồi quy).
- ❌ **F1 (reviewer #2 báo CRITICAL) = FALSE POSITIVE.** Controller verify: `notification.ts:23` lọc theo `recipientId ∈ studentIds`, KHÔNG theo recipientType; ADR 0002 ghim RLS principal theo `recipient_id`. PH vẫn nhận nhắc họp. Residual: chỉ drift mô tả spec↔code.
- 🟡 Phát hiện thật còn lại: MED-1 (postNote nhận facilityId từ client, cho null → chèn note xuyên cơ sở), MED-2 (Chatter nuốt lỗi), F2 (claim "RLS 37/37" không có script backing), F3 (CI chưa chạy — no remote), F4/F5/F8/F10/F12 (lỗ coverage int-test), F6 (attendance streak ở charter nhưng chưa build), F7 (test cadence đặt tên sai), F9/F11 (logic finance cần soát).

## Backlog (thứ tự thực thi)

| # | Việc | Loại | Verify-gate (điều kiện đóng) | Trạng thái |
|---|---|---|---|---|
| **T1** | Git chuẩn: dọn .gitignore, commit doc, tạo remote private, push main+branch, mở PR | quy trình | ~~CI xanh GH Actions~~ → **CI/CD dựng bằng Jenkins (sau)**; verify thay bằng local pipeline | 🟡 git xong (PR #1 mở, **chưa merge** — chủ dự án tạm dừng); CI deferred |
| T2 | MED-1: `audit.postNote` resolve facilityId server-side từ entity (security-class tenancy) | bảo mật | int-test: staff cơ sở B chèn note vào entity cơ sở A → bị chặn | ✅ done 2026-06-24 (`audit-postnote-tenancy.int.test.ts` 3/3 PASS, full int-suite 21/21; 2-agent review SAFE-TO-CLOSE) |
| T3 | MED-2: Chatter có error state (không nuốt lỗi 401/network) | UX | live: giả 401 → hiện lỗi rõ | ✅ code done 2026-06-24 — `chatter.tsx` thêm error state → Alert (load + post không còn nuốt lỗi); typecheck+lint xanh. ⏳ live verify (giả 401) cần app chạy. |
| T4 | F11: validate voucher validFrom/validTo ngay `receiptCreate` (fail-early) | nghiệp vụ | int-test: voucher hết hạn bị chặn ở create, không phải approve | ✅ done 2026-06-24 — `voucher-window-fail-early.int.test.ts` 3/3 (hết hạn/chưa hiệu lực chặn ở create + 0 draft; approve vẫn re-check nguyên tử). |
| T5 | F9: soát phân loại win-back `kind` (O5 vs entrance test mới) theo spec | nghiệp vụ | xác nhận spec → fix nếu sai + int-test | ✅ done 2026-06-24 — chủ dự án chốt **giữ nguyên** (history-based khi không gắn opp); lock bằng `receipt-kind-classification.int.test.ts` (O5→new; no-opp+prior→renewal; no-opp+fresh→new). |
| T6 | F4: int-test `assessment.computeFinalGrade` loại grade chưa publish | coverage | test seed published+unpublished → FinalGrade chỉ tính published | ✅ done 2026-06-24 — `assessment-final-grade-publish.int.test.ts` (mutation: bỏ filter → 8.55 thay 9.6). Code đã đúng. |
| T7 | F5: int-test grade→badge auto-award + idempotency (mutation-proven) | coverage | publish 2 lần → 1 badge; bỏ unique → test fail đúng chỗ | ✅ done 2026-06-24 — `badge-auto-award-idempotency.int.test.ts` (publish 2× → 1 badge; bảo vệ 3 lớp: `@@unique` + skipDuplicates + pre-filter). |
| T8 | F8: assert certificate được tạo trong test level-up approve | coverage | `expect(certs).toHaveLength(1)` | ✅ done 2026-06-24 — `level-up-certificate.int.test.ts` (0→1 cert qua approve; idempotent). |
| T9 | F10: int-test e2e `commissionForSale` (receiptApprove→soldById→groupBy) | coverage | test tái lập 8.5tr@quota10tr | ✅ done 2026-06-24 — `commission-for-sale-e2e.int.test.ts` (số thật từ params: 8.5tr@quota10tr = 85% → band 2% → 170k; soldById/kind frozen ở approve). |
| T10 | F12: mutation test cho batch-code atomicity (mã B-YYYY-NNNN) | coverage | bỏ advisory lock → đua sinh trùng mã → test fail | ✅ done 2026-06-24 — `batch-code-atomicity.int.test.ts` (15 call đua qua service + tRPC → unique+tuần tự; `pg_advisory_xact_lock`). |
| T11 | F2: viết script verify RLS đa-bảng (iterate mọi bảng tenant) HOẶC sửa claim "37/37" | bảo mật/claim | script chạy chứng minh mọi bảng cô lập | ✅ done 2026-06-24 — `rls-coverage.int.test.ts` introspect schema: **39/39** bảng có `facility_id` đều bật RLS + policy (0 gap; claim "37/37" sai số, đã sửa). Guard chặn bảng mới quên RLS. |
| T12 | F6+F7+F1-residual: charter ghi "streak chưa build"; rename test cadence; chỉnh mô tả spec parent-meeting recipient | tài liệu | doc khớp code | ✅ done 2026-06-24 — charter+phase-01: streak chưa build (verified: 0 impl); rename `parent-meeting-cadence`→`-reminder-idempotency`; parent-meeting.md sửa recipient = `recipientType='student'/recipientId=studentId` (khớp service, PH nhận qua feed). |
| **T13** | **Feature: auto-cadence họp PH** — config cadence (UCREA 5/BI+BH 3/tháng) + auto-sinh lịch theo lớp active + chặn tạo đột xuất; cập nhật spec | feature | int-test: lớp active sinh đúng số buổi/tháng; tạo vượt cadence bị chặn; live verify | ✅ done 2026-06-24 — auto-gen theo program (neo class.startDate), lớp `running`, idempotent (unique key); bỏ ad-hoc `create`; cron daily; 2-agent review (sửa bug month-end clamp). Plan: `plans/260624-1627-parent-meeting-auto-cadence/`. 3 việc tồn → backlog #2/#3/#4. |
| T14 | P2: dựng eslint thật + thêm step lint vào CI (bỏ script no-op) | nợ | `turbo run lint` chạy thật, CI có gate lint | 🟡 eslint xong 2026-06-24 — flat config (eslint 9 + ts-eslint + react), wire 13 workspace, `pnpm -r lint` xanh (0 err/warn), dọn dead-code thật. Gate CI chờ Jenkins (DEBT). |
| T15 | Lên kế hoạch Phase 5 (after-sale, Guardian UI, dashboard BGĐ/MAES, certificate auto-gen) | planning | plan.md Phase 5 | ⬜ |

## Quyết định nghiệp vụ đã chốt (2026-06-24)
- **Cadence họp PH:** hệ thống **auto sinh lịch** theo cadence cấu hình; **không có họp đột xuất**; nhắc nội bộ để nhân viên gọi PH. → T13.

## Nguyên tắc đóng việc
1. Code xong → **tự chạy** test/lệnh liên quan (không tin "có vẻ đúng").
2. Việc bảo mật/nghiệp vụ rủi ro (T2, T5, T11, T13) → **2-agent review** trước khi đóng.
3. Done = bằng chứng thật (test PASS dán ra / live URL), không phải "code merged".

## Phụ thuộc
- T1 mở khóa mọi verify CI (T2+ nên có CI chạy để regression net có nghĩa).
- T2–T12 độc lập nhau, làm tuần tự.
- T13 là feature mới, sau khi net ổn.

## Trạng thái thực thi (2026-06-24)
- T1 git: ✅ repo private `manhquydev/CMCnew`, `main`+nhánh đã push, PR #1 **đã merge về main** (2026-06-24).
- ⛔ GitHub Actions chết do billing (account). **Quyết định: CI/CD dựng bằng Jenkins (sau).** Tới lúc đó verify = chạy local pipeline. Xem `DEBT.md`.
- ✅ T2 đóng 2026-06-24: `audit.postNote` bỏ facilityId client, resolve từ entity qua RLS (whitelist receipt/opportunity/class_batch), chặn note xuyên cơ sở + chặn lỗ `facility_id IS NULL` global. Cleanup prop `facilityId` ở `Chatter` + 3 call site. 2-agent review SAFE-TO-CLOSE. Report: `plans/reports/from-code-reviewer-to-flow-260624-1558-postnote-tenancy-med1-security-review-report.md`.
- ✅ Cụm coverage T6–T10 đóng 2026-06-24 (5 tester-agent ck song song, mỗi agent 1 file test): +13 case, full int-suite **34/34 PASS**, typecheck sạch. KHÔNG phát hiện defect — code đã đúng, test chốt lại invariant. Reports: `plans/reports/tester-260624-16*-{...}-report.md`.
- ✅ Phiên 2026-06-24 (claudekit agent + verify thật): đóng **T2, T4, T6–T12, T14** — int-suite **40/40 PASS**, typecheck + `pnpm -r lint` xanh. 6 commit trên `develop` (52acb5f, 7b431d9, d1d7376, daa13ff, f9a7d81, 35447b9).
- ⏭️ Còn lại: **T3** (Chatter error-state — frontend, cần live verify), **T5** + **T13** (cần soát spec trước — không tự quyết nghiệp vụ), **T15** (plan Phase 5). Việc tồn LOW: `audit.follow` chưa gate entity-visibility (không phải vector MED-1).

## Câu hỏi mở
- T5/T13: chi tiết quy tắc win-back & cadence cần đối chiếu spec trước khi code.
- Jenkins: host ở đâu (local/server), trigger nào (poll/webhook) — chốt khi bắt tay dựng.

## Liên kết
- Review reports: `plans/reports/from-code-reviewer-1-correctness-260624-1458-hardening-diff-report.md`, `plans/reports/from-code-reviewer-2-business-coverage-260624-1458-invariant-audit-report.md`
- Plan hardening trước: `plans/20260624-business-hardening/plan.md`
