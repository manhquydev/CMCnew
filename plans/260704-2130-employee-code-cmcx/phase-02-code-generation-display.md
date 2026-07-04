---
phase: 2
title: Code generation & display
status: completed
priority: P1
dependencies:
  - 1
effort: M
---

# Phase 2: Code generation & display

## Overview

Cấp mã khi tạo hồ sơ nhân sự (`payroll.upsertEmploymentProfile`) và hiển thị `CMC0001 · Họ tên · email` trên danh sách phiếu công ca.

## Requirements

- Functional: hồ sơ mới (chưa có mã) được cấp mã atomic; mã không đổi khi update; danh sách công ca hiện mã.
- Non-functional: cấp mã atomic tránh trùng; giữ RLS; không đổi mã đã cấp.

## Architecture

**Sinh mã (`apps/api/src/routers/payroll.ts` ~ dòng 453 `upsertEmploymentProfile`):**
Sau khi upsert hồ sơ, nếu `employeeCode` còn NULL → cấp mã atomic qua counter (pattern giống `submit` của shift SR-code):

```ts
const profile = await tx.employmentProfile.upsert({ /* … */ });
if (!profile.employeeCode) {
  const [{ next }] = await tx.$queryRawUnsafe<{ next: number }[]>(
    `INSERT INTO employee_code_counter (id, last_seq) VALUES (1, 1)
     ON CONFLICT (id) DO UPDATE SET last_seq = employee_code_counter.last_seq + 1
     RETURNING last_seq AS next`,
  );
  const code = `CMC${String(next).padStart(4, '0')}`;
  await tx.employmentProfile.update({ where: { id: profile.id }, data: { employeeCode: code } });
  profile.employeeCode = code;
}
```

Cấp một lần: điều kiện `if (!profile.employeeCode)` đảm bảo update hồ sơ về sau không đổi mã. Atomic INSERT…ON CONFLICT tránh trùng khi 2 HR tạo đồng thời.

> ⚠️ **Cân nhắc (validate):** nếu backfill Phase 1 chưa chạy mà hook chạy trước, `last_seq` bắt đầu từ 0 → có thể trùng dải với backfill. **Thứ tự bắt buộc: deploy migration (Phase 1) TRƯỚC, rồi mới code hook (Phase 2).** Migration đã set `last_seq = COUNT` nên hook tiếp nối đúng.

**Hiển thị (`apps/admin/src/shift-reg-list-panel.tsx`):**
Plan A đã resolve `user{displayName,email}` qua batch-map trong `shiftRegistration.list`. Plan B mở rộng batch-map đó thêm `employeeCode`:
- Backend `list`: batch-map hiện tại query `appUser.findMany`. Thêm resolve mã: `tx.employmentProfile.findMany({ where:{ userId:{ in:userIds } }, select:{ userId:true, employeeCode:true } })` → merge vào `user.employeeCode`. (KHÔNG dùng relation include — `EmploymentProfile` cũng là loose ref theo `userId`.)
- Frontend: cột "Nhân sự" render `CMC0001 · Họ tên` + email dimmed; fallback khi thiếu mã: chỉ `Họ tên · email` (hồ sơ chưa cấp mã / user không có hồ sơ).

## Related Code Files

- Modify: `apps/api/src/routers/payroll.ts` (hook cấp mã trong `upsertEmploymentProfile`)
- Modify: `apps/api/src/routers/shift-registration.ts` (mở rộng batch-map `list` thêm `employeeCode`)
- Modify: `apps/admin/src/shift-reg-list-panel.tsx` (render mã trong cột Nhân sự)

## Implementation Steps

1. Thêm block cấp mã atomic vào `upsertEmploymentProfile` (chỉ khi `!employeeCode`).
2. Mở rộng batch-map trong `shiftRegistration.list` để gắn `employeeCode` (qua `employmentProfile.findMany`).
3. Cập nhật cột "Nhân sự" ở list panel hiển thị `CMC0001 · Họ tên · email`, có fallback.
4. (Tùy chọn, ngoài scope vòng này) surface mã ở danh sách nhân sự/payroll — để phase sau.

## Success Criteria

- [ ] Tạo hồ sơ mới → có mã `CMCxxxx` liền kề, không trùng.
- [ ] Update hồ sơ đã có mã → mã giữ nguyên.
- [ ] Danh sách phiếu công ca hiện `CMC0001 · Họ tên · email`; thiếu mã → fallback tên+email.
- [ ] Cấp mã đồng thời (2 tx) không trùng (atomic counter).

## Risk Assessment

- **Thứ tự deploy:** migration Phase 1 trước, hook Phase 2 sau — nếu ngược sẽ trùng dải mã.
- RLS: `employee_code_counter` INSERT…ON CONFLICT phải chạy được trong `withRls` (đã kiểm ở Phase 1).
- Batch-map thêm 1 query `employmentProfile` — giữ theo userIds đã gom, không N+1.
- `padStart(4)` khi seq > 9999 → CMC10000 (không cắt) — chấp nhận, vẫn duy nhất.
