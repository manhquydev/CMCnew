# Agent #3: API & Integration Design

## tRPC Router Design

### Router: `shiftConfig` (Danh mục ca)

```typescript
export const shiftConfigRouter = router({
  // List shift types for a facility (theo group)
  list: requirePermission('shiftConfig', 'list')
    .input(z.object({
      facilityId: z.number().int().positive(),
      group: z.nativeEnum(ShiftGroup).optional(), // filter theo nhóm
    }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.shiftType.findMany({
          where: { facilityId: input.facilityId, group: input.group, archivedAt: null },
          orderBy: { sortOrder: 'asc' },
        }),
      ),
    ),

  // CRUD — super_admin / giam_doc_*
  create: requirePermission('shiftConfig', 'create')
    .input(z.object({
      facilityId: z.number().int().positive(),
      code: z.string(),
      name: z.string(),
      group: z.nativeEnum(ShiftGroup),
      startTime: z.string(),
      endTime: z.string(),
      breakStart: z.string().optional(),
      breakEnd: z.string().optional(),
      totalHours: z.number().positive(),
    }))
    .mutation(...),
});
```

### Router: `shiftRegistration` (Phiếu đăng ký công ca)

```typescript
export const shiftRegistrationRouter = router({
  // ─── CRUD ───
  list: requirePermission('shiftReg', 'list')
    .input(z.object({
      facilityId: z.number().int().positive(),
      status: z.nativeEnum(ShiftRegStatus).optional(),
      userId: z.string().uuid().optional(),
    }))
    .query(...),

  // Tạo phiếu mới (Draft) — tự động resolve manager + shift group
  create: requirePermission('shiftReg', 'create')
    .input(z.object({
      facilityId: z.number().int().positive(),
      fromDate: z.string(), // YYYY-MM-DD
      toDate: z.string(),
    }))
    .mutation(async ({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        // 1. Lấy EmploymentProfile để xác định shift group
        const profile = await tx.employmentProfile.findUniqueOrThrow({
          where: { userId: ctx.session.userId },
        });
        const shiftGroup = resolveShiftGroup(profile.position);
        // 2. Lấy manager hierarchy
        const managerId = profile.managerId ?? resolveManagerByRole(profile);
        const nextManagerId = resolveNextManager(managerId);
        // 3. Tạo phiếu
        return tx.shiftRegistration.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.userId,
            fromDate: new Date(input.fromDate),
            toDate: new Date(input.toDate),
            status: 'draft',
            shiftGroup,
            managerId,
            nextManagerId,
          },
        });
      }),
    ),

  // Lấy chi tiết phiếu + bảng đăng ký
  get: requirePermission('shiftReg', 'get')
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.shiftRegistration.findUniqueOrThrow({
          where: { id: input.id },
          include: {
            days: {
              include: { shifts: { include: { shiftType: true } } },
              orderBy: { date: 'asc' },
            },
          },
        }),
      ),
    ),

  // Cập nhật ca cho 1 ngày (upsert)
  updateDay: requirePermission('shiftReg', 'updateDay')
    .input(z.object({
      dayId: z.string().uuid().optional(), // null = tạo mới
      registrationId: z.string().uuid(),
      date: z.string(), // YYYY-MM-DD
      shiftTypeIds: z.array(z.string().uuid()), // các ca được chọn
    }))
    .mutation(async ({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        // Validate phiếu đang ở DRAFT
        // Validate shift group: business → tối đa 1 shiftTypeId
        // Upsert ShiftDay + ShiftDayShift
        // Tính totalHours = sum(shiftType.totalHours)
      }),
    ),

  // ─── WORKFLOW ───
  submit: requirePermission('shiftReg', 'submit')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        // Validate: status = draft, có ít nhất 1 ngày được đăng ký
        // Generate code: SR-YYYY-NNNN
        // status → submitted
        // Gửi StaffNotification cho manager
      }),
    ),

  withdraw: requirePermission('shiftReg', 'withdraw')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        // Validate: status = submitted, manager chưa duyệt
        // status → draft
      }),
    ),

  approve: requirePermission('shiftReg', 'approve')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        // Validate: status = submitted, approver là manager hoặc nextManager
        // Tìm phiếu APPROVED cũ trùng ngày → supersede
        // status → approved
      }),
    ),

  reject: requirePermission('shiftReg', 'reject')
    .input(z.object({ id: z.string().uuid(), reason: z.string() }))
    .mutation(async ({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        // Validate: status = submitted
        // status → draft, lưu rejectReason
      }),
    ),

  // Lấy ca đã đăng ký trong tháng (cho hiển thị badge)
  registeredInMonth: requirePermission('shiftReg', 'registeredInMonth')
    .input(z.object({
      userId: z.string().uuid(),
      yearMonth: z.string(), // YYYY-MM
    }))
    .query(async ({ ctx, input }) => {
      // Đếm số ngày có ít nhất 1 ca trong tháng, status=approved
    }),
});
```

### Router: `checkInOut` (Chấm công)

```typescript
export const checkInOutRouter = router({
  // Kiểm tra IP hiện tại có thuộc facility không
  checkIP: protectedProcedure
    .input(z.object({ facilityId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const clientIP = getClientIP(ctx.req); // từ X-Real-IP
      const allowed = await ctx.db.facilityIP.findFirst({
        where: { facilityId: input.facilityId, ipAddress: clientIP, isActive: true },
      });
      // Cũng check IP range (CIDR)
      return { allowed: !!allowed, ip: clientIP };
    }),

  checkIn: requirePermission('checkInOut', 'checkIn')
    .mutation(async ({ ctx }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const clientIP = getClientIP(ctx.req);
        // 1. Validate IP
        // 2. Check chưa checkin hôm nay
        // 3. Tìm ca đăng ký hôm nay (ShiftDay) để biết expected startTime
        // 4. So sánh giờ → isLate
        // 5. Tạo record
      }),
    ),

  checkOut: requirePermission('checkInOut', 'checkOut')
    .mutation(async ({ ctx }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        // 1. Validate đã checkin hôm nay
        // 2. Tạo record checkout
        // 3. So sánh giờ với expected endTime → isEarly
      }),
    ),

  todayStatus: protectedProcedure
    .query(({ ctx }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.checkInOut.findMany({
          where: { userId: ctx.session.userId, timestamp: { gte: startOfToday() } },
          orderBy: { timestamp: 'desc' },
        }),
      ),
    ),

  history: requirePermission('checkInOut', 'history')
    .input(z.object({
      userId: z.string().uuid().optional(), // optional = self
      fromDate: z.string(),
      toDate: z.string(),
    }))
    .query(...),

  monthlyReport: requirePermission('checkInOut', 'monthlyReport')
    .input(z.object({
      facilityId: z.number().int().positive(),
      yearMonth: z.string(),
    }))
    .query(...),
});
```

### Router: `facilityIP` (Cấu hình IP)

```typescript
export const facilityIPRouter = router({
  list: requirePermission('facilityIP', 'list')
    .input(z.object({ facilityId: z.number().int().positive() }))
    .query(...),

  create: requirePermission('facilityIP', 'create')
    .input(z.object({
      facilityId: z.number().int().positive(),
      ipAddress: z.string(),
      label: z.string().optional(),
    }))
    .mutation(...),

  delete: requirePermission('facilityIP', 'delete')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(...),
});
```

## Permission Registry (new entries)

```typescript
// Trong packages/auth/src/permissions.ts
shiftConfig: {
  list: ['giao_vien', 'head_teacher', 'sale', 'cskh', 'ctv_mkt', 'quan_ly',
         'giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
  create: ['super_admin'],
  update: ['super_admin'],
  delete: ['super_admin'],
},

shiftReg: {
  list: ['giao_vien', 'head_teacher', 'sale', 'cskh', 'ctv_mkt', 'quan_ly',
         'giam_doc_kinh_doanh', 'giam_doc_dao_tao', 'hr'],
  create: ['giao_vien', 'head_teacher', 'sale', 'cskh', 'ctv_mkt'], // ai cũng tự tạo
  get: ['giao_vien', 'head_teacher', 'sale', 'cskh', 'ctv_mkt', 'quan_ly',
        'giam_doc_kinh_doanh', 'giam_doc_dao_tao', 'hr'],
  updateDay: ['giao_vien', 'head_teacher', 'sale', 'cskh', 'ctv_mkt'],
  submit: ['giao_vien', 'head_teacher', 'sale', 'cskh', 'ctv_mkt'],
  withdraw: ['giao_vien', 'head_teacher', 'sale', 'cskh', 'ctv_mkt'],
  approve: ['quan_ly', 'giam_doc_kinh_doanh', 'giam_doc_dao_tao', 'bgd'],
  reject: ['quan_ly', 'giam_doc_kinh_doanh', 'giam_doc_dao_tao', 'bgd'],
  registeredInMonth: ['giao_vien', 'head_teacher', 'sale', 'cskh', 'ctv_mkt', 'hr'],
},

checkInOut: {
  checkIn: ['giao_vien', 'head_teacher', 'sale', 'cskh', 'ctv_mkt'], // ai cũng tự checkin
  checkOut: ['giao_vien', 'head_teacher', 'sale', 'cskh', 'ctv_mkt'],
  history: ['giao_vien', 'head_teacher', 'sale', 'cskh', 'ctv_mkt', 'quan_ly',
            'giam_doc_kinh_doanh', 'giam_doc_dao_tao', 'hr'],
  monthlyReport: ['quan_ly', 'giam_doc_kinh_doanh', 'giam_doc_dao_tao', 'hr', 'ke_toan'],
},

facilityIP: {
  list: ['super_admin', 'quan_ly'],
  create: ['super_admin'],
  delete: ['super_admin'],
},
```

## Integration với KpiScore + Payslip

### Flow: CheckInOut → KPI
```
Cron job (đầu tháng):
  1. SELECT checkins WHERE period = lastMonth
  2. Tính: lateCount, absentCount, earlyCount
  3. UPDATE KpiScore.autoScore += attendanceScore
```

### Flow: CheckInOut → Payslip
```
payslipCompute():
  workdays = COUNT(DISTINCT DATE(timestamp)) FROM CheckInOut WHERE action='in'
  (thay vì HR nhập tay workdays)
```

## StaffNotification events mới

```typescript
enum StaffNotifEvent {
  // ... existing ...
  shift_reg_submitted    // Phiếu đăng ký ca chờ duyệt → manager
  shift_reg_approved     // Phiếu được duyệt → user
  shift_reg_rejected     // Phiếu bị từ chối → user
  shift_reg_superseded   // Phiếu cũ bị thay thế → user
}
```
