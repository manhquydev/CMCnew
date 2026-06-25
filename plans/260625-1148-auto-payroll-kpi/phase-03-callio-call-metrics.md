# Phase 03 — Callio call-metrics: client + polling + snapshot

## Context

- Decision [0010](../../docs/decisions/0010-callio-call-metrics-integration.md). API verified live.
- Env: `CALLIO_API_BASE`, `CALLIO_API_TOKEN` (đã thêm `.env.example`).

## CDR shape đã khóa (verify 2026-06-25)

`GET /call?from=<ms>&to=<ms>&page=&pageSize=100` (header `token`). Fields dùng:
`direction` ("outbound"|"inbound"), `billDuration` (giây đàm thoại), `duration` (tổng),
`fromExt`, `fromUser.{email,ext,name}`, `startTime` (epoch ms). Paging: `hasNextPage`, `totalDocs`.
Filter `from`/`to` OK server-side; `ext` KHÔNG filter server → lọc client-side.

## Requirements

- Client `callioClient`: paginate `/call` theo [from,to], header token, backoff 429, timeout 30s.
- Cuộc hợp lệ = `direction==="outbound" && billDuration > 5`.
- Map `fromUser.email` → `AppUser`; cần `EmploymentProfile.callioExt` (mới) để map theo ext khi
  email không khớp.
- Snapshot `CallMetric` (mới): `(userId, facilityId, periodKey)` unique, `validCalls`, `totalCalls`,
  `totalTalkSec`, `syncedAt`. Đóng băng để payslip tái lập.
- Procedure `payroll.syncCallMetrics(periodKey, facilityId)` (HR/super) → gọi Callio, upsert snapshot.
- Token trống = no-op (validCalls=0), không lỗi.

## Files

- `packages/db/prisma/schema.prisma` — model `CallMetric` + `EmploymentProfile.callioExt` + migration + RLS (facility-scoped, hr/ke_toan/super).
- `apps/api/src/lib/callio-client.ts` (mới).
- `apps/api/src/routers/payroll.ts` — `syncCallMetrics`.
- `apps/api/test/callio-call-metrics.int.test.ts` — mock HTTP (fetch) trả CDR mẫu; verify lọc >5s + outbound + map user + snapshot idempotent.

## Validation

- Int-test với fixture CDR (dựa response thật đã capture): 3 cuộc (outbound 7s, outbound 3s,
  inbound 20s) → validCalls=1. Re-sync cùng kỳ = idempotent.
- RLS: quan_ly đọc CallMetric = FORBIDDEN.

## Risks

- Rate limit chưa rõ → backoff. Múi giờ epoch ms → chuẩn hóa ICT khi tính tuần.
- Không commit token; chỉ đọc env.
