# Plan — Làm chắc nghiệp vụ (Business Hardening)

> Mục tiêu: biến các bất biến nghiệp vụ đã verify-thủ-công thành **lưới an toàn tự động** trước khi build thêm. Local-first; deploy/prod để sau.
> Lập: 2026-06-24 · Nguyên tắc chủ dự án: *"Nghiệp vụ cần chắc trước mới triển khai tiếp."*

## Bối cảnh (đã verify 2026-06-24)
Nghiệp vụ đã build là **đúng**: 112 unit-test domain PASS, typecheck sạch, mọi invariant rủi ro cao (voucher/sao/mã atomic, finalize lương M6, PIT 7 bậc, RLS 37/37 bảng + principal-aware 10/10) có bằng chứng file:line. **Rủi ro còn lại = không có gì chống vỡ khi refactor** (tầng router chỉ test bằng curl; CI chưa chạy domain-test/lint).

## Trạng thái
| Phase | Tên | Mức | Trạng thái |
|---|---|---|---|
| 01 | Integration test khóa invariant (tiền/tenancy/lương) | P0 | ✅ **xong + verified** — 12 test PASS; mutation sweep 6/6 bắt được lỗi (xem report 01b) |
| 02 | Siết CI: thêm test vào gate | P0 | ✅ unit+integration đã vào CI · ⏸️ lint hoãn (chưa có eslint — việc riêng) |
| 03 | Hoàn thiện nghiệp vụ còn thiếu (chatter UI + chốt hoa hồng) | P1 | ✅ **xong** — Chatter gắn thêm Receipt + Opportunity; hoa hồng A+ (nút "Đưa vào ô biến đổi") đã có sẵn. typecheck PASS |
| 04 | Backlog go-live (object store, rate-limit, receipt PDF) | P2 | ⬜ (chỉ chốt khi lên prod) |

## Đã làm (2026-06-24)
- Hạ tầng integration test (`apps/api/test/`, `vitest.integration.config.ts`, script `test:int`) gọi router thật qua tRPC caller trên Postgres thật.
- 7 test PASS, 3 lớp invariant: voucher atomic (đua/refund/cap35%), RLS tenancy (đọc cô lập + WITH CHECK ghi bị chặn), payslip finalize gating.
- **Chứng minh có răng:** bỏ guard `used_count<max_uses` → race test FAIL đúng chỗ; revert lại PASS.
- CI: thêm step `Unit tests` (`pnpm -r test`, 112 test) + `Integration tests` (`test:int`, 7 test) trước build.
- Lint: KHÔNG thêm step rỗng — repo chưa có eslint/lint script; ghi nợ là việc riêng (dựng eslint trước).
- Review độc lập: APPROVE_WITH_NITS (3 nit LOW không chặn). Không đụng source production (`apps/api/src` diff rỗng).

## Phụ thuộc
- 02 phụ thuộc 01 (có test mới gắn vào CI cho ý nghĩa).
- 03 độc lập, làm song song được sau khi 01 xong.
- 04 không đụng tới cho đến mốc go-live.

## Acceptance tổng
- [ ] Integration test chạy trên Postgres thật, phủ các invariant ở Phase 01, PASS local.
- [ ] CI fail nếu một invariant bị phá (voucher đua / RLS xuyên cơ sở / non-HR đọc lương / finalize gating).
- [ ] `pnpm -r test` + lint là gate bắt buộc trong `.github/workflows/ci.yml`.
- [ ] Quyết định hoa hồng v1 (nhập tay vs auto-ghép) được chủ dự án chốt và ghi lại.

## Mở rộng net (2026-06-24, PM-điều phối 3 agent)
- +3 invariant khóa qua integration test (mutation 3/3 bắt): **reward refund** (reject→hoàn sao+phục hồi stock), **level-up authz** (chỉ head_teacher duyệt→ghi Student.level), **parent-meeting dedup** (remindedAt idempotent).
- Tổng: **18 integration test / 8 lớp invariant.** Commit `19d79d3`.
- ⚠️ Phát hiện: quy tắc **cadence tháng** họp PH (UCREA 5 / BI+BH 3) **chưa enforce trong code** (`create` nhận scheduledAt tùy ý) — chỉ remindedAt dedup là testable. Việc mở nếu cần siết cadence.

## Kiểm tra trạng thái (verified 2026-06-24, phiên rà soát — bằng chứng từ code)
5 đầu việc treo từ phiên trước, xác minh lại bằng file:line (không tin báo cáo cũ):

1. **Cadence họp PH — CHƯA enforce.** `apps/api/src/routers/parent-meeting.ts` `create` nhận `scheduledAt` tùy ý, không chặn số buổi/tháng. `parent-meeting-cadence.int.test.ts` thực chất test `remindedAt` dedup (idempotent nhắc T-1), KHÔNG test cadence. Cadence (UCREA 5 / BI+BH 3) chỉ ở `docs/specs/parent-meeting.md`. → **Quyết định nghiệp vụ mở** (enforce backend vs giữ thủ công).
2. **Push + PR — BỊ CHẶN.** `git remote -v` rỗng → chưa có remote. Nhánh đi trước `main` 5 commit, 0 sau. Merge local OK; push/PR cần thêm remote GitHub trước.
3. **Live verify Phase 03 — CHƯA.** UI chatter có thật (`apps/teaching/src/crm-panel.tsx`, `finance-panel.tsx`) nhưng chưa chạy app thật → chưa có done-evidence live.
4. **Coverage — như báo cáo.** 8 integration + 7 domain unit. Thiếu int-test: grade→badge, attendance streak, certificate, FinalGrade, class-batch.
5. **Lint — CHƯA dựng.** Không có eslint config; CI không có step lint (trung thực); script root `"lint": "turbo run lint"` là no-op.

**Phát hiện mới (báo cáo cũ bỏ sót):**
- 🔴 **CI chưa từng chạy thật.** `.github/workflows/ci.yml` đủ step (typecheck→unit→integration→verify-RLS→build) nhưng không remote → chưa thực thi. "CI xanh" là done-evidence chưa chứng minh.

**Cập nhật acceptance (theo bằng chứng quan sát phiên này, chưa tự chạy lại test):**
- [x] Integration test tồn tại, phủ invariant Phase 01 (8 file `apps/api/test/*.int.test.ts`).
- [x] CI định nghĩa fail-trên-vỡ-invariant (step Integration tests trong ci.yml) — *nhưng chưa chạy được do thiếu remote.*
- [ ] `pnpm -r test` + **lint** là gate bắt buộc — lint CHƯA có, để mở.
- [x] Quyết định hoa hồng v1 — đã chốt & ghi (xem mục Trạng thái phase 03).

## Liên kết
- Phase 01: [phase-01-invariant-integration-tests.md](phase-01-invariant-integration-tests.md)
- Phase 02: [phase-02-ci-gates.md](phase-02-ci-gates.md)
- Phase 03: [phase-03-business-completeness.md](phase-03-business-completeness.md)
- Phase 04: [phase-04-go-live-backlog.md](phase-04-go-live-backlog.md)
- Nguồn nghiệp vụ: `docs/specs/phase-0{1..4}.md`, `docs/project-charter.md`
- Nợ kỹ thuật: `DEBT.md`, `docs/security-phase0-hardening-backlog.md`
