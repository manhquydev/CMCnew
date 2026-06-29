# Phase 02 — CRM API + logic

## Context
- Router: `apps/api/src/routers/crm.ts` (đã có `contactCreate`, `opportunityCreate`, `opportunityTransition`, `opportunityMarkLost`, `opportunityReopen`, `leadIngest`).
- RBAC registry: `packages/auth/src/permissions.ts` + parity test `apps/api/test/permission-parity.test.ts`.
- Audit: `logEvent` (RecordEvent) đã dùng trong router.
- **Bất biến giữ nguyên:** `Opportunity.ownerId` vẫn nuôi `Receipt.soldById` tại `finance.receiptApprove` — B1 chỉ THÊM log, KHÔNG đổi nghĩa ownerId. RLS facility giữ nguyên (Q1).

## Requirements
1. **B1 — assignment log + reassign**
   - Helper `logAssignment(tx, {facilityId, opportunityId, fromOwnerId, toOwnerId, assignedById, reason})` → tạo `OpportunityAssignment` + `logEvent` chatter.
   - `opportunityCreate`: nếu set `ownerId` → ghi 1 dòng (from=null → to=owner).
   - Procedure mới `opportunityReassign` (input: opportunityId, toOwnerId, reason?): cập nhật `ownerId` + ghi log; chỉ manager-roles (CRM_MANAGER_ROLES) hoặc giữ rule owner-self như create — **quyết định:** reassign = manager-only (đổi chủ là hành vi quản lý). Ghi vào registry.
   - Procedure `assignmentHistory` (input: opportunityId) → list append-only, mới→cũ.
2. **B2 — attribution capture**
   - `contactCreate` + `upsertContact` helper + `leadIngest`: nhận thêm `medium?`, `campaign?`; lưu vào Contact. Validate string optional.
3. **B4 — lostReason enum**
   - `opportunityMarkLost` input đổi `lostReason: z.string()` → `z.nativeEnum(LostReason)` + `lostNote: z.string().optional()`. Lưu cả hai.
   - `opportunityList`: cho phép filter optional theo `lostReason`.
4. **Permission registry**: thêm `opportunityReassign`, `assignmentHistory` vào `crm` với grant đúng (reassign: manager-roles; history: như opportunityList). Cập nhật parity test.

## Files
- Modify: `apps/api/src/routers/crm.ts`
- Modify: `packages/auth/src/permissions.ts`
- Modify (tests): `apps/api/test/permission-parity.test.ts` + thêm test mới (xem dưới)

## Validation (integration, theo pattern apps/api/test)
- `crm-assignment.test.ts`: create-with-owner ghi 1 dòng; reassign A→B ghi dòng đúng from/to/by; non-manager reassign bị chặn; history append-only.
- `crm-lost-reason.test.ts`: markLost giá trị enum hợp lệ pass; giá trị ngoài enum bị Zod reject; filter list theo reason.
- `crm-attribution.test.ts`: contactCreate/leadIngest lưu medium+campaign.
- Permission parity xanh. `pnpm --filter @cmc/api typecheck`.

## Risks
- Đụng `opportunityMarkLost` contract (đổi kiểu input) → là breaking nhẹ cho client; UI phase-03 cập nhật đồng bộ. Không client ngoài.
- Walk `finance.receiptApprove` để chắc ownerId→soldById không đổi.
