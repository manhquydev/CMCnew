---
phase: 1
title: Backend workflow & validation
status: completed
priority: P1
dependencies: []
effort: M
---

# Phase 1: Backend workflow & validation

## Overview

Sửa `shift-registration.ts`: khoá tạo phiếu (A1), rule ngày tương lai + mutation `updateDates` (A2), include chủ phiếu vào `list` (A4). Thêm permission `updateDates`.

## Requirements

- Functional: create guard chặn `draft`+`submitted`; `fromDate > today` (Asia/Saigon) ở create/updateDates/submit; `updateDates` sửa range + dọn entries ngoài range; `list` trả `user{displayName,email}`.
- Non-functional: giữ RLS, advisory-lock, supersede, guard chủ phiếu; so ngày an toàn timezone (không lệch UTC).

## Architecture

**Helper "hôm nay" theo Asia/Saigon (KISS, tránh bẫy UTC):** vì `fromDate` là chuỗi `YYYY-MM-DD`, so sánh chuỗi với ngày hiện tại ở Asia/Saigon:

```ts
// today theo Asia/Saigon dạng 'YYYY-MM-DD'
function saigonToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
}
// hợp lệ khi fromDate (chuỗi) đứng sau hôm nay
function assertFutureFrom(fromDate: string) {
  if (fromDate <= saigonToday()) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Từ ngày phải là ngày trong tương lai (từ ngày mai trở đi)' });
  }
}
```

So sánh lexicographic trên `YYYY-MM-DD` == so sánh ngày. Dùng cùng 1 helper ở create/updateDates/submit để nhất quán.

**A1 — create guard:** đổi điều kiện tồn tại từ `status:'submitted'` sang `status:{ in: ['draft','submitted'] }`; message: "Bạn đang có phiếu chưa hoàn tất (Nháp/Chờ duyệt) — hãy mở phiếu đó để sửa thay vì tạo phiếu mới."

**A2 — updateDates (mutation mới):** chỉ chủ phiếu, chỉ `draft`; validate `fromDate ≤ toDate` và `assertFutureFrom(fromDate)`; cập nhật `fromDate/toDate`; xoá `shiftRegistrationEntry` có `date < fromDate OR date > toDate` **trong cùng tx**; `logEvent` type `updated` ghi range cũ→mới + số entry đã dọn.

**A4 — resolve chủ phiếu (KHÔNG dùng include — không có relation):** ⚠️ `ShiftRegistration.userId` là **loose UUID ref, KHÔNG có Prisma relation `user`** (chỉ `shiftGroup`/`entries` là relation). Vì vậy `include:{user}` **sẽ không compile**. Cách đúng — **batch-map**: sau khi `findMany` regs, gom `userIds = [...new Set(regs.map(r=>r.userId))]`, query `tx.appUser.findMany({ where:{ id:{ in:userIds } }, select:{ id:true, displayName:true, email:true } })`, dựng `Map<id,{displayName,email}>`, gắn vào từng reg trả về (VD `regs.map(r => ({ ...r, user: map.get(r.userId) ?? null }))`). Không nới `visibleRegistrationWhere`.

> ⚠️ **RLS-check bắt buộc (red-team):** query `appUser.findMany` vẫn chạy trong `withRls`. Kiểm RLS trên `app_user` (migration `app_user_rls_and_token_trigger`) có cho manager/HR đọc user khác cùng facility không. Nếu chặn → trả thiếu tên. Phương án nếu bị chặn: (a) xác nhận policy đã cho đọc trong facility, hoặc (b) resolve qua surface đã whitelisted cho HR/giám đốc. Ghi kết quả kiểm tra vào phase trước khi code.

**Permission:** thêm `updateDates: ['giao_vien','sale','cskh']` vào `packages/auth/src/permissions.ts` (khối `shiftRegistration`, cùng tập với `updateEntry`). Router dùng `requirePermission('shiftRegistration','updateDates')`.

## Related Code Files

- Modify: `apps/api/src/routers/shift-registration.ts` (create guard, submit guard, updateDates mới, list include, helper ngày)
- Modify: `packages/auth/src/permissions.ts` (thêm `updateDates`)
- Modify: `apps/api/test/fixtures/permission-snapshot.json` (thêm dòng `shiftRegistration.updateDates`)

## Implementation Steps

1. Thêm helper `saigonToday()` + `assertFutureFrom()` ở đầu router (hoặc `../lib/`).
2. `create`: đổi guard sang `status:{ in:['draft','submitted'] }`; gọi `assertFutureFrom(input.fromDate)` sau check range.
3. Thêm mutation `updateDates` theo Architecture (permission + owner + draft + range + future + dọn entries + audit).
4. `submit`: trước khi đổi status, gọi `assertFutureFrom(reg.fromDate.toISOString().slice(0,10))` (hoặc format Saigon) — chặn phiếu nháp để lâu thành quá khứ.
5. `list`: batch-map chủ phiếu (`appUser.findMany` theo userIds → gắn `user{displayName,email}` vào mỗi reg). KHÔNG dùng include.
6. `permissions.ts`: thêm `updateDates`; cập nhật `permission-snapshot.json`.

## Success Criteria

- [ ] `create` ném CONFLICT khi có phiếu draft/submitted; qua khi chỉ còn approved/cancelled.
- [ ] `create`/`updateDates`/`submit` ném BAD_REQUEST khi `fromDate ≤ hôm nay` (Asia/Saigon).
- [ ] `updateDates` đổi range + xoá đúng entries ngoài range + audit-log; chỉ chủ phiếu + chỉ draft.
- [ ] `list` trả kèm `user.displayName`/`user.email` qua batch-map (không dùng relation include).
- [ ] permission-parity test xanh sau khi thêm `updateDates`.

## Risk Assessment

- **BLOCKER:** `apps/api` bị xoá working tree — `git checkout -- apps/api` trước khi sửa.
- Timezone: chỉ dùng helper Saigon, không so `new Date()` trực tiếp (lệch +7h gây sai biên nửa đêm).
- `updateDates` dọn entries: phải trong cùng tx với update range để tránh trạng thái nửa vời.
- Nếu bỏ sót snapshot/permission → parity test đỏ (được Phase 4 bắt).
- **Behavior change (legacy drafts):** phiếu `draft` cũ có `fromDate` đã thành quá khứ sẽ KHÔNG submit được sau khi thêm guard — user phải sửa ngày (updateDates) rồi nộp lại. Chấp nhận (đúng ý nghiệp vụ); ghi vào changelog/thông báo khi rollout.
- **RLS trên AppUser include:** xem cảnh báo mục A4 — verify trước khi implement.
