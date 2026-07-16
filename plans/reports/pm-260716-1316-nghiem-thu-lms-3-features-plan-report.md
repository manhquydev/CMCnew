# Nghiệm thu: LMS 3-features plan (post-cook)

Ngày: 2026-07-16 | Commit: `0feefac` (develop, 61 file) | Plan: `plans/260716-0856-lms-schedule-rewards-exercises/plan.md`

## Tóm tắt

6/6 phase implement xong, test-first, code-review từng phase (5 sạch, 1 tìm bug thật đã fix).
Dev-verify trực tiếp qua browser (không chỉ dựa test) cho tất cả phase. Prod seed (Phase 5)
deferred đúng theo gate high-risk đã chốt — chưa chạy.

## Kết quả thực tế vs kế hoạch

| Phase | Trạng thái | Lệch kế hoạch |
|---|---|---|
| 1 — Hide Schedule | Done | Không |
| 2 — Gift Photo Store | Done | Có — prod driver S3→disk+bind-mount (quyết định 0041) |
| 3 — Gift Upload UI | Done | Không (1 bug thật tìm+fix qua review: cross-record photo-ref leak) |
| 4 — Render Gift Image | Done | Có — PH ra khỏi scope (không có gift catalog, user xác nhận) |
| 5 — Seed Gifts | Dev done, **prod deferred** | Không lệch — đúng gate kế hoạch |
| 6 — Exercises Upcoming UX | Done | Không |

Chi tiết đầy đủ (bảng so sánh + 5 vấn đề phát sinh) đã ghi trong `plan.md` §"Nghiệm thu (post-cook)".

## Vấn đề mới phát sinh — đã đóng
1. Ops S3→disk: giả định plan gốc stale, đã re-confirm user + ghi quyết định 0041.
2. Vị trí CLI seed khác plan (dependency direction) — đã document trong phase-05.
3. PH scope Phase 4 thu hẹp — user xác nhận.

## Vấn đề mới phát sinh — CHƯA đóng (cần quyết định user)
1. **5 test suite fail pre-existing, không liên quan** (`director-user-create`, 4 file payroll —
   lỗi "Không tìm thấy nhân sự" ở `beforeAll`, tái hiện độc lập, xác nhận không phải regression
   từ plan này). Cần: fix ngay (task riêng) hay chấp nhận nợ kỹ thuật đã biết?
2. **Prod seed run** (migration + 21 quà × mọi facility) — đang chờ lệnh xác nhận riêng.

## Unresolved Questions
- Có cần điều tra/fix 5 test suite payroll fail không, hay để đó?
- Khi nào chạy migration + seed thật trên prod?
