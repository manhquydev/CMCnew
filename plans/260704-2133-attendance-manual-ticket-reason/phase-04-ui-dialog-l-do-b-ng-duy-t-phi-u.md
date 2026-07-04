---
phase: 4
title: "UI dialog lý do & bảng duyệt phiếu"
status: completed
priority: P1
dependencies: [3]
---

# Phase 4: UI dialog lý do & bảng duyệt phiếu

## Overview

FE: khi `punch` trả `requiresReason` → xổ dialog nhập lý do rồi gọi lại `punch({reason})`. Bảng "Chờ duyệt ngoài WiFi" chuyển sang duyệt **phiếu** (approve/reject) thay vì từng punch.

## Requirements

- Functional:
  - Bấm chấm công ngoài WiFi lần đầu/ngày → server trả `requiresReason` → mở modal nhập lý do (Mantine modal + Textarea, min 3 ký tự) → gọi `punch({reason})`. Phân biệt `resubmit=true` (phiếu bị từ chối) → tiêu đề modal "Phiếu bị từ chối — nhập lý do mới". Lỗi `CONFLICT` (debounce) → toast, KHÔNG mở modal.
  - Lần sau cùng ngày (phiếu pending/approved) → không mở modal.
  - **H1**: dùng `status.manualApproval` — `rejected` → KHÔNG badge xanh "Hoàn thành", hiện badge đỏ "Bị từ chối — liên hệ quản lý"; `pending` → badge "Chờ duyệt"; `approved`/ip → như cũ.
  - Bảng manager: mỗi dòng = 1 phiếu (nhân viên, lý do, số lần bấm, ca) + nút **Duyệt** và **Từ chối**.
- Non-functional: giữ style hiện có (Card/Table/Badge Mantine + biến `--cmc-*`).

## Architecture

- Gọi `punch.mutate()`; nếu kết quả `requiresReason` → set state mở modal, không báo lỗi. Submit modal → `punch.mutate({ reason })`.
- Đổi `pendingManual`/`approveManual` binding sang shape ticket (Phase 3). Thêm `rejectManual` call + note optional.
- `attendanceApi`/`shallow-trpc.ts`: cập nhật nếu có type binding cứng.

## Related Code Files

- Modify: `apps/admin/src/checkin-panel.tsx` (punch handler + modal + bảng duyệt phiếu)
- Modify (nếu cần): `apps/admin/src/shallow-trpc.ts` (type `pendingManual` mới)
- Modify (E2E): `apps/e2e/tests/work-shift-manual-punch-approval.spec.ts` (đổi flow theo phiếu)

## Implementation Steps

1. **Test-first (component/E2E)**: cập nhật/thêm E2E:
   a. staff ngoài WiFi bấm → modal lý do hiện → nhập → punch tạo, phiếu pending.
   b. staff bấm lần 2 → không modal.
   c. manager thấy phiếu, bấm Duyệt → phiếu biến mất khỏi pending.
   d. manager Từ chối → phiếu rời pending; (kiểm notify nếu khả thi).
   Chạy → đỏ.
2. Thêm state modal + Textarea lý do; nối `requiresReason`.
3. Viết lại bảng duyệt sang phiếu; thêm nút Từ chối (+ optional note).
4. `pnpm --filter @cmc/admin typecheck`.
5. Chạy E2E → xanh.

## Success Criteria

- [ ] Modal lý do chỉ hiện lần đầu/ngày (hoặc khi phiếu bị từ chối, tiêu đề resubmit) khi ngoài WiFi; `CONFLICT` không mở modal.
- [ ] Ngày bị từ chối KHÔNG hiện badge xanh "Hoàn thành"; hiện "Bị từ chối"/"Chờ duyệt" đúng `manualApproval`.
- [ ] Bảng manager duyệt/từ chối theo phiếu; sau thao tác cập nhật danh sách.
- [ ] `@cmc/admin typecheck` sạch; E2E manual-punch xanh.
- [ ] Không lộ thông tin thừa trong modal/bảng (IP giữ ở cột manager là hợp lệ).

## Risk Assessment

- Modal chặn double-submit: disable nút khi `busy`; server debounce là chốt cuối.
- E2E cũ dựa trên duyệt per-punch sẽ vỡ → cập nhật trong phase này (đã liệt kê file).
- Persona login E2E: non-super_admin password login đang hỏng (SSO-only) — nếu spec cần staff persona, dùng cơ chế seed/SSO hiện có, không tự sửa auth ở plan này (ngoài phạm vi).
