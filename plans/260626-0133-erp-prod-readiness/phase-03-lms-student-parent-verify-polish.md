---
phase: 3
title: "LMS student-parent verify+polish"
status: pending
priority: P2
dependencies: [1]
---

# Phase 3: LMS student-parent verify+polish

## Overview

Verify LMS live bằng cách tạo seed account học sinh + phụ huynh, đăng nhập vào browser, chụp ảnh các tab. Sửa bất kỳ lỗi hiển thị nào tìm thấy trong quá trình verify. Student-view.tsx (715 dòng) và parent-view.tsx (584 dòng) đã được viết — mục tiêu phase này là confirm hoạt động và fix issues nếu có.

## Requirements

- Có account học sinh để login vào LMS tab "Học sinh"
- Có account phụ huynh để login vào LMS tab "Phụ huynh"
- Student tabs hoạt động: overview, exercises, results, gradebook, badges, ranking, rewards
- Parent tabs hoạt động: gradebook, lịch họp phụ huynh
- Không có crash/error màn hình trắng

## Architecture

LMS App.tsx → LoginGate với mode "lms" → StudentShell hoặc ParentShell → student-view.tsx / parent-view.tsx

Seed accounts cần thêm vào `packages/db/src/seed.ts`:
- 1 student account có enrollment trong lớp
- 1 guardian account linked với student đó

## Related Code Files

- Modify: `packages/db/src/seed.ts` — thêm student + guardian seed accounts
- Modify: `apps/lms/src/student-view.tsx` — fix nếu tìm thấy lỗi
- Modify: `apps/lms/src/parent-view.tsx` — fix nếu tìm thấy lỗi
- Reference: `apps/lms/src/student-shell.tsx`, `apps/lms/src/parent-shell.tsx`

## Implementation Steps

### 1. Thêm seed LMS accounts

Trong `packages/db/src/seed.ts`, thêm sau phần super_admin seed:

```ts
// Student seed — dùng role 'student' nếu có, hoặc tạo Student record
const seedStudent = await prisma.student.upsert({
  where: { fullName: 'Nguyễn Thị Test' }, // dùng unique constraint
  create: {
    fullName: 'Nguyễn Thị Test',
    dob: new Date('2018-01-01'),
    program: 'UCREA',
    facilityId: 1, // HQ
  },
  update: {},
});
console.log('✓ Seed student:', seedStudent.fullName);

// Guardian seed
const guardianUser = await prisma.user.upsert({
  where: { email: 'parent@cmc.local' },
  create: {
    email: 'parent@cmc.local',
    displayName: 'Phụ Huynh Test',
    passwordHash: await hashPassword(process.env.SEED_SUPERADMIN_PASSWORD ?? 'ChangeMe!123'),
    roles: ['guardian'] as any,
    primaryRole: 'guardian' as any,
    isActive: true,
  },
  update: {},
});

// Guardian link
await prisma.guardianStudent.upsert({
  where: { guardianId_studentId: { guardianId: guardianUser.id, studentId: seedStudent.id } },
  create: { guardianId: guardianUser.id, studentId: seedStudent.id, facilityId: 1 },
  update: {},
});
console.log('✓ Seed guardian: parent@cmc.local');
```

Chạy: `pnpm --filter @cmc/db seed`

### 2. Tạo LMS student account để login

LMS dùng Student record chứ không phải User? Kiểm tra `apps/lms/src/App.tsx` và auth flow để hiểu cách login hoạt động cho "Học sinh" tab.

Nếu LMS login dùng student email/phone:
- Xem `apps/api/src/routers/auth.ts` → route `lmsLogin`
- Đảm bảo seed student có `phone` hoặc `email` field

### 3. Verify trong browser

```
http://localhost:5175 → tab "Học sinh" → login
- Overview tab: thấy enrollment/class info
- Exercises tab: bài tập (có thể empty nếu chưa có exercise seed)
- Badges tab: huy hiệu (có thể empty)
- Rewards tab: cửa hàng quà

http://localhost:5175 → tab "Phụ huynh" → login parent@cmc.local
- Gradebook: thấy điểm học sinh
- Họp PH: thấy lịch họp
```

### 4. Fix issues phát hiện khi verify

Ghi lại từng issue + fix. Common issues dự đoán:
- Empty states thiếu helpful message
- Error khi API trả empty array nhưng UI không handle gracefully
- Typos trong label tiếng Việt

### 5. Verify build

```bash
pnpm --filter @cmc/lms build
pnpm --filter @cmc/db seed
pnpm -r typecheck
```

## Success Criteria

- [ ] Seed chạy không lỗi, tạo được student + guardian records
- [ ] Login LMS student tab thành công, thấy ít nhất 1 tab có data
- [ ] Login LMS parent tab thành công, thấy gradebook (dù empty)
- [ ] Không có console error nghiêm trọng (404/500)
- [ ] Typecheck + build pass

## Risk Assessment

**Medium** — Cần hiểu đúng auth flow của LMS (student vs User model). Nếu LMS dùng Student record trực tiếp (không qua User table) thì seed logic khác. Cần đọc `apps/api/src/routers/auth.ts` trước khi seed.

Fallback nếu student login không rõ: dùng existing integration test setup để hiểu cách tạo LMS session.
