# PM session — Điều phối mở rộng lưới regression

Ngày: 2026-06-24 14:37 · PM: Claude · Branch: test/invariant-integration-harness

## Mục tiêu phiên
Nắm trạng thái → điều phối agent chuyên biệt khóa nốt các invariant nghiệp vụ rủi ro cao (top 3) → giám sát → báo cáo.

## Điều phối (3 agent song song, author-only, PM tích hợp)
| Agent | Nhiệm vụ | Kết quả |
|---|---|---|
| general-purpose #1 | reward review refund | ❌ lần 1 (0 tool_uses) → **re-dispatch OK** |
| general-purpose #2 | level-progress authz | ✅ author đúng ngay |
| general-purpose #3 | parent-meeting dedup | ✅ author đúng ngay |

**Ràng buộc tôn trọng:** 1 DB chung + suite serial → agent **chỉ author file riêng, không chạy suite**; PM gom + chạy tuần tự + fix + mutation-check + commit (pattern đã chứng minh).

## Kết quả (ground-truth)
- **18/18 integration test PASS** (trước phiên 12 → +6: level 4, reward 1, parent-meeting 1). Lần chạy tích hợp đầu tiên xanh hết — agent viết chuẩn.
- **Mutation 3/3 bắt** (apply→fail→revert):
  - reward: bỏ phục hồi stock → FAIL ✓
  - level-progress: cho giao_vien duyệt → FAIL ✓
  - parent-meeting: bỏ remindedAt dedup → FAIL ✓
- typecheck PASS · src tree sạch sau sweep · commit `19d79d3` (chưa push, đúng yêu cầu).

## Trạng thái dự án sau phiên
| Hạng mục | Trạng thái |
|---|---|
| Lưới regression | **8 lớp invariant / 18 test**, verified mutation |
| CI gate | test ✅ · lint ⏸️ (chưa có eslint) |
| Plan business-hardening | P01 ✅ P02 ✅ P03 ✅ · P04 go-live ⬜ deferred |
| Branch | 5 commit, chưa push |

## Phát hiện đáng chú ý (từ agent)
- **Cadence tháng họp PH chưa enforce trong code** — `parentMeeting.create` nhận `scheduledAt` tùy ý, không có helper tính chu kỳ UCREA 5mo / BI+BH 3mo. Quy tắc mới là "ý định tài liệu", chưa thành code → không có gì để test/khóa. **Quyết định mở:** có cần siết cadence ở backend không?
- level-progress.decide auto-phát Certificate + Notification cùng tx (side-effect) — test đã cleanup đúng.

## Việc còn mở (unresolved)
1. **Cadence họp PH**: enforce ở backend hay giữ thủ công? (nghiệp vụ — cần chủ dự án quyết)
2. **Lint/eslint**: chưa dựng → CI chưa gác lint (P2).
3. **Live verify Phase 03**: click-through drawer "Nhật ký" trên app chạy thật (done-evidence cuối).
4. **Push + PR**: gom Phase 01–03 + net mở rộng vào main — chờ anh quyết.
5. Coverage còn lại (trung bình): grade→badge/earn, attendance streak, certificate auto-gen, FinalGrade weighting, class-batch B-code+cancel — batch sau nếu muốn phủ kín.
