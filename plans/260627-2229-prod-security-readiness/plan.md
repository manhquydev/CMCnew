# Prod Security Readiness — CMCnew

Status: IN_PROGRESS — 2026-06-27 · Branch: develop · Lane: high-risk (auth, money, RLS, infra)

Mục tiêu: đóng hết vấn đề security còn lại + đưa dự án sẵn sàng prod **mọi khía cạnh**, không sót việc.
Nguồn: 10-agent audit (`plans/reports/qa-260627-2109-...md`) + code-review + scout hạ tầng.

## ✅ Đã xong (các turn trước — đã verify + test 324 xanh)
- H1 SSO fail-closed (chỉ super_admin password; staff SSO-only) · H2 loginCode unique toàn cục · H3 KPI gate approved
- M15 redact điểm chưa publish (submission.save) · M9 addSlot facilityId server-derived · M1 scrub secret outbox · M6(a) leadIngest token constant-time
- SSO env wiring compose · cookie path `/` · email lowercase · onboarding SSO-only (bỏ password form)
- Hạ tầng sẵn tốt: nginx security headers (X-Frame/CSP/nosniff/Referrer) · secrets gitignored, 0 secret committed · login rate-limit · RLS per-facility

## 🔧 Phase A — Code security còn lại (làm round này)
| ID | Vấn đề | File | Loại |
|----|--------|------|------|
| A1 | leadIngest chưa rate-limit (public endpoint) | crm.ts + rate-limit.ts | security |
| A2 | kpiOverride không gate status → sửa được phiếu `approved` (bỏ qua SoD) | payroll.ts | authz |
| A3 | KPI confirm bỏ qua `scores` (Zod strip) → chỉnh sửa mất | payroll.ts + panel | integrity |
| A4 | opportunityTransition regress deal WON (clear closedAt) không guard | crm.ts | integrity |
| A5 | termUpdate thiếu validate start<=end | assessment.ts | integrity |
| A6 | certificate.issue không check FinalGrade.passed | certificate.ts | integrity |
| A7 | attendance.mark không check enrollment active / session cancelled | attendance.ts | integrity |
| A8 | passMark client-supplied (grader gửi 0 → pass hết) | grade.ts/assessment | integrity |
| A9 | M14 email test leak client secret ra stdout + phụ thuộc env | email-graph-client.test | test-hygiene |
| A10 | SSO authorize thiếu nonce (defense-in-depth; PKCE+state đã có) | sso.ts | low-sec |

## 🌐 Phase B — Hạ tầng prod (cần SSH/cert/giá trị của bạn — plan + chuẩn bị sẵn)
| ID | Việc | Ai làm |
|----|------|--------|
| B1 | TLS/HTTPS: nginx 443 + cert (Let's Encrypt/Cloudflare) | bạn cấp domain+cert/SSH; tôi viết config |
| B2 | Bật HSTS header khi có TLS | tôi (config sẵn, kèm note) |
| B3 | `.env.production`: ENTRA_*/GRAPH_SENDER_*/redirect prod/SSO/`SEED_SUPERADMIN_EMAIL=admin@cmcvn.edu.vn`/`COOKIE_SECURE=true` | bạn điền giá trị; tôi viết template + checklist |
| B4 | Đổi mật khẩu `cmc_app` mặc định sau migrate | bạn chạy lệnh (tôi viết runbook) |
| B5 | Backup DB định kỳ (pg_dump cron / volume snapshot) | tôi viết script + compose service |
| B6 | Rà soát dependency vuln (vitest/vite chỉ dev → ngoài image prod; xác nhận) | tôi xác nhận + note |
| B7 | Runbook deploy + lockout pre-SSO (chỉ super_admin login tới khi SSO wired) | tôi viết docs/ |

## Phase C — Verify
- `pnpm --filter @cmc/api typecheck` + full int suite (324) sau mỗi nhóm.
- code-reviewer cho Phase A (auth/money/authz).
- Live smoke trên stack docker sau rebuild.

## Acceptance
- Mọi finding security/integrity Phase A đóng + test phủ.
- Phase B có artifact sẵn dùng (config/script/runbook/checklist) để bạn deploy qua SSH.
- 0 regression; 324+ test xanh; code-review PASS.

## Cập nhật tiến độ (2026-06-27 tối)
- ĐÃ XONG Phase A: A2, A4, A5, A9 (commit 6b2a862) · A1, A7 (2eeabe0) · A6, A3, A8-mitigation (59df909).
- Quyết định owner: chứng chỉ TẮT (ẩn nav) · passMark server-controlled · KPI confirm read-only (sửa qua kpiOverride có log).

### Follow-up còn lại (cần round sau)
- **A8-config**: passMark cấu hình per-course do admin đặt (thêm field Course.passMark + migration + ô trong form khóa học + computeFinalGrade đọc từ đó). Hiện tạm hardcode 5/program.
- **KPI nhân-sự-chỉ-xem** (vision owner): hiện `kpiEvalSubmit` cho nhân viên TỰ chấm điểm mình. Theo ý owner "nhân sự chỉ xem, không sửa thông số" → đổi luồng: hệ thống auto (kpiAutoPrefill) + quản lý điều chỉnh (kpiOverride có log); bỏ/khóa self-submit. Là thay đổi luồng + UI self-KPI → cần plan riêng + xác nhận.
- **A10** SSO nonce (low, PKCE+state đã đủ) · **A8 cũ** passMark admin-config.
- Phase B hạ tầng: theo `docs/prod-deploy-security-runbook.md` (cần SSH/cert của owner).

## Out of scope (round này)
- Low UX/cosmetic không ảnh hưởng bảo mật (dead-end button director, audit body typo).
- Tính năng mới.

## Rủi ro/rollback
- Mỗi nhóm commit riêng → revert độc lập. Auth/money đổi nhỏ, có test guard.
