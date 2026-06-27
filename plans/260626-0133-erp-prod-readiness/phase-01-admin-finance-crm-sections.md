---
phase: 1
title: "Admin Finance+CRM sections"
status: pending
priority: P1
dependencies: []
---

# Phase 1: Admin Finance+CRM sections

## Overview

Thêm 2 nav section mới vào Admin app: **Tài chính** (receipt list + approve workflow) và **CRM** (pipeline kanban O1→O5). Reuse `FinancePanel` + `CrmPanel` từ Teaching — không viết lại.

## Requirements

- ke_toan + quan_ly + super_admin thấy "Tài chính" trong sidebar admin
- quan_ly + sale + super_admin thấy "CRM" trong sidebar admin
- Panel logic giống hệt Teaching (same tRPC calls), chỉ khác context (admin layout)

## Architecture

```
apps/admin/src/
  shell.tsx          ← thêm 2 SectionKey + nav items
  App.tsx            ← thêm 2 case trong renderContent()
  finance-panel.tsx  ← copy từ apps/teaching/src/finance-panel.tsx (hoặc symlink)
  crm-panel.tsx      ← copy từ apps/teaching/src/crm-panel.tsx
```

Lý do copy thay vì import cross-app: monorepo pnpm workspace không support cross-app imports. Shared logic nên vào `packages/ui` nhưng đó là tech debt riêng, không block phase này.

## Related Code Files

- Modify: `apps/admin/src/shell.tsx`
- Modify: `apps/admin/src/App.tsx`
- Create: `apps/admin/src/finance-panel.tsx`
- Create: `apps/admin/src/crm-panel.tsx`
- Reference: `apps/teaching/src/finance-panel.tsx` (source of truth)
- Reference: `apps/teaching/src/crm-panel.tsx` (source of truth)

## Implementation Steps

### 1. Thêm SectionKey vào shell.tsx

```tsx
// shell.tsx — thêm vào SectionKey union
type SectionKey = 'overview' | 'courses' | 'org' | 'guardians'
  | 'hr' | 'kpi' | 'compensation'
  | 'finance' | 'crm';  // ← mới

// Thêm vào ALL_ADMIN_KEYS Set
const ALL_ADMIN_KEYS = new Set<string>([
  'overview', 'courses', 'org', 'guardians', 'hr', 'kpi', 'compensation',
  'finance', 'crm',  // ← mới
]);

// SECTION_TITLES
const SECTION_TITLES: Record<SectionKey, string> = {
  ...existing,
  finance: 'Tài chính',
  crm: 'CRM',
};

// buildNavGroups — thêm group KINH DOANH
{
  groupLabel: 'KINH DOANH',
  items: [
    { key: 'finance', label: 'Tài chính', icon: <IconReceipt size={18}/>, visible: canFinance },
    { key: 'crm', label: 'CRM', icon: <IconTrendingUp size={18}/>, visible: canCrm },
  ],
}
```

### 2. Tạo finance-panel.tsx trong Admin

Copy từ `apps/teaching/src/finance-panel.tsx` — không thay đổi logic, chỉ export tên mới nếu cần.

File có: receipt list table (status filter: draft/approved/sent/reconciled/cancelled), create receipt modal (chọn student + course + voucher), approve/send actions inline.

### 3. Tạo crm-panel.tsx trong Admin

Copy từ `apps/teaching/src/crm-panel.tsx` — giữ nguyên logic.

File có: create opportunity form, pipeline kanban/list (O1→O5 stages), test schedule table.

### 4. Wiring trong App.tsx

```tsx
// Thêm imports
import { FinancePanel } from './finance-panel';
import { CrmPanel } from './crm-panel';

// Thêm guards
const canFinance = me.isSuperAdmin || me.roles.some(r => ['ke_toan','quan_ly'].includes(r));
const canCrm = me.isSuperAdmin || me.roles.some(r => ['sale','quan_ly','cskh'].includes(r));

// Thêm vào buildNavGroups call
buildNavGroups({ canHr, canKpi, isSuperAdmin, canFinance, canCrm });

// Thêm vào ALL_ADMIN_KEYS guard
if (key === 'finance' && !canFinance) return;
if (key === 'crm' && !canCrm) return;

// Thêm vào renderContent switch
case 'finance':
  return canFinance ? <FinancePanel /> : null;
case 'crm':
  return canCrm ? <CrmPanel /> : null;
```

### 5. Verify

```bash
pnpm --filter @cmc/admin build
pnpm -r typecheck
```

## Success Criteria

- [ ] Admin sidebar: thấy "Tài chính" + "CRM" với đúng role (ke_toan thấy finance; sale thấy crm)
- [ ] Finance panel load được receipt list (dù empty)
- [ ] CRM panel load được pipeline (dù empty)
- [ ] Typecheck + build pass toàn monorepo

## Risk Assessment

**Low risk** — chỉ copy code đã proven, thêm nav routing. Không động schema, không động API.

Edge case: `FinancePanel` trong Teaching gọi `trpc.finance.receiptList.query()` không có facilityId filter — admin super_admin sẽ thấy ALL receipts. Đây là behavior đúng cho admin.
