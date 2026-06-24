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
| T2 | MED-1: `audit.postNote` resolve facilityId server-side từ entity (security-class tenancy) | bảo mật | int-test: staff cơ sở B chèn note vào entity cơ sở A → bị chặn | ⬜ |
| T3 | MED-2: Chatter có error state (không nuốt lỗi 401/network) | UX | live: giả 401 → hiện lỗi rõ | ⬜ |
| T4 | F11: validate voucher validFrom/validTo ngay `receiptCreate` (fail-early) | nghiệp vụ | int-test: voucher hết hạn bị chặn ở create, không phải approve | ⬜ |
| T5 | F9: soát phân loại win-back `kind` (O5 vs entrance test mới) theo spec | nghiệp vụ | xác nhận spec → fix nếu sai + int-test | ⬜ (cần soát spec) |
| T6 | F4: int-test `assessment.computeFinalGrade` loại grade chưa publish | coverage | test seed published+unpublished → FinalGrade chỉ tính published | ⬜ |
| T7 | F5: int-test grade→badge auto-award + idempotency (mutation-proven) | coverage | publish 2 lần → 1 badge; bỏ unique → test fail đúng chỗ | ⬜ |
| T8 | F8: assert certificate được tạo trong test level-up approve | coverage | `expect(certs).toHaveLength(1)` | ⬜ |
| T9 | F10: int-test e2e `commissionForSale` (receiptApprove→soldById→groupBy) | coverage | test tái lập 8.5tr@quota10tr | ⬜ |
| T10 | F12: mutation test cho batch-code atomicity (mã B-YYYY-NNNN) | coverage | bỏ advisory lock → đua sinh trùng mã → test fail | ⬜ |
| T11 | F2: viết script verify RLS đa-bảng (iterate mọi bảng tenant) HOẶC sửa claim "37/37" | bảo mật/claim | script chạy chứng minh mọi bảng cô lập | ⬜ |
| T12 | F6+F7+F1-residual: charter ghi "streak chưa build"; rename test cadence; chỉnh mô tả spec parent-meeting recipient | tài liệu | doc khớp code | ⬜ |
| **T13** | **Feature: auto-cadence họp PH** — config cadence (UCREA 5/BI+BH 3/tháng) + auto-sinh lịch theo lớp active + chặn tạo đột xuất; cập nhật spec | feature | int-test: lớp active sinh đúng số buổi/tháng; tạo vượt cadence bị chặn; live verify | ⬜ (đã chốt nghiệp vụ) |
| T14 | P2: dựng eslint thật + thêm step lint vào CI (bỏ script no-op) | nợ | `turbo run lint` chạy thật, CI có gate lint | ⬜ |
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
- ⏭️ Kế tiếp: T2 (MED-1 postNote — bảo mật tenancy), chạy 2-agent review trước khi đóng.

## Câu hỏi mở
- T5/T13: chi tiết quy tắc win-back & cadence cần đối chiếu spec trước khi code.
- Jenkins: host ở đâu (local/server), trigger nào (poll/webhook) — chốt khi bắt tay dựng.

## Liên kết
- Review reports: `plans/reports/from-code-reviewer-1-correctness-260624-1458-hardening-diff-report.md`, `plans/reports/from-code-reviewer-2-business-coverage-260624-1458-invariant-audit-report.md`
- Plan hardening trước: `plans/20260624-business-hardening/plan.md`
