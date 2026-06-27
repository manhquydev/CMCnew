---
phase: 2
title: "HR Panel Redesign — Staff Table + Detail Drawer"
status: pending
priority: P1
dependencies: []
---

# Phase 02: HR Panel Redesign

## Overview

`apps/admin/src/payroll-panel.tsx` hiện chỉ có 1 Select dropdown "Chọn người".
Redesign thành: Staff list table → click row → Drawer chi tiết (payslips + KPI + bulk pay).

## Architecture

```
PayrollPanel
├── StaffTable (trpc.user.list → filter staff roles)
│   └── Row click → open Drawer với staffId
└── StaffDetailDrawer(staffId)
    ├── StaffInfoCard (tên, role, bậc lương hiện tại)
    ├── PayslipList (trpc.payroll.myPayslips hoặc payroll.list filtered by staffId)
    ├── KpiSummary (trpc.kpiEvaluation.list filtered by staffId)
    └── BulkPaySection (chọn payslips → payslipBulkPay)
```

## Related Code Files

- Modify: `apps/admin/src/payroll-panel.tsx` — full redesign
- Read: `apps/admin/src/App.tsx` — xem type imports hiện tại
- Read: `apps/api/src/routers/payroll.ts` — xem available queries

## Implementation Steps

### 1. StaffTable component

```tsx
// Dùng trpc.user.list, filter ra các role nhân sự
const STAFF_ROLES = ['giao_vien','head_teacher','sale','ke_toan','hr','quan_ly','bgd','cskh','ctv_mkt'];

function StaffTable({ onSelect }: { onSelect: (userId: string) => void }) {
  const [users] = trpc.user.list.useSuspenseQuery();
  const staff = users.filter(u => u.roles.some(r => STAFF_ROLES.includes(r)));

  return (
    <Table striped highlightOnHover style={{ cursor: 'pointer' }}>
      <Table.Thead>
        <Table.Tr>
          <Table.Th style={TH_STYLE}>Tên</Table.Th>
          <Table.Th style={TH_STYLE}>Vai trò</Table.Th>
          <Table.Th style={TH_STYLE}>Cơ sở</Table.Th>
          <Table.Th style={TH_STYLE}>Bậc lương</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {staff.map(u => (
          <Table.Tr key={u.id} onClick={() => onSelect(u.id)}>
            <Table.Td>{u.displayName}</Table.Td>
            <Table.Td>
              <Group gap={4}>
                {u.roles.slice(0,2).map(r => (
                  <Badge key={r} size="xs" variant="light" radius="xl">{r}</Badge>
                ))}
              </Group>
            </Table.Td>
            <Table.Td>{u.facilityCount}</Table.Td>
            <Table.Td>—</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
```

### 2. StaffDetailDrawer

```tsx
function StaffDetailDrawer({ staffId, onClose }: { staffId: string | null; onClose: () => void }) {
  const opened = !!staffId;
  // payroll.list với filter staffId — check router có hỗ trợ không
  // Nếu không: dùng myPayslips (cần super_admin context) hoặc payroll.listByStaff

  return (
    <Drawer opened={opened} onClose={onClose} position="right" size="lg"
      title="Thông tin nhân sự" padding="xl">
      {staffId && <StaffDetailContent staffId={staffId} />}
    </Drawer>
  );
}
```

### 3. BulkPaySection

```tsx
// Hiện payslips status=finalized → checkbox → Bulk pay button
// Dùng payslipBulkPay mutation đã có
const bulkPay = trpc.payroll.payslipBulkPay.useMutation({
  onSuccess: (r) => {
    notifySuccess(`Đã thanh toán ${r.succeeded.length} phiếu`);
    if (r.failed.length) notifyError(`${r.failed.length} phiếu lỗi`);
  },
  onError: notifyError,
});
```

### 4. Check payroll router capabilities

Trước khi implement, read `apps/api/src/routers/payroll.ts` để xác nhận:
- `payslip.list` có filter `staffId` không? Hay chỉ có `myPayslips`?
- `payslipBulkPay` đã có (confirmed từ backend)
- Nếu list thiếu filter: thêm `payslipListByStaff(staffId)` vào router (super_admin + hr + ke_toan)

## Success Criteria

- [ ] Admin HR panel hiển thị danh sách nhân viên dạng table
- [ ] Click row → Drawer mở với payslip list + KPI summary
- [ ] Drawer có nút bulk pay cho payslips finalized
- [ ] Bulk pay mutate thành công → toast + refresh
- [ ] Empty state khi chưa có payslip
- [ ] typecheck + build xanh

## Risk Assessment

- **Trung bình**: cần verify payroll router có `listByStaff` — nếu không có thì cần thêm 1 endpoint mới
- **Mitigation**: Đọc router trước, thêm endpoint nhỏ nếu cần (trong scope, không phá contract)
- Super admin context có thể bypass IDOR guard → cần test với role hr/ke_toan cũng thấy đúng
