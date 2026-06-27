# Final Operational Completion — bản dùng được + bootstrap 3-heads

Status: IN PROGRESS · Branch: feature/erp-unify-rbac-f0 · 2026-06-27

## Mục tiêu (từ goal)
Ra **bản cuối dùng/vận hành được**, build full local như prod, reset sạch + seed tài khoản khởi tạo, có hướng dẫn vận hành theo **org thật**. Verify thực tế đa-agent + check server log + devops đánh giá. Xong → commit, push develop, đóng nhánh.

## Context thật (đã verify code 2026-06-27 — tránh nhầm context cũ)
- `user.create` + toàn bộ user mgmt = **super_admin only** (`apps/api/src/routers/user.ts`).
- Role enum: super_admin, quan_ly, head_teacher, giao_vien, ke_toan, hr, sale, cskh, ctv_mkt, bgd.
- `docs/operate-and-test-guide.md` LỖI THỜI (3-app cũ; chưa có 3-heads). F0B đã gộp về 1 staff app (apps/admin).
- Auth = Microsoft SSO (R1-R5) + break-glass password; local cần COOKIE_SECURE=false.

## Org thật (user mô tả) → mô hình RBAC (QUYẾT ĐỊNH)
3 người đứng đầu tự tạo & quản lý đội (hiện: giáo viên + sale):
- **IT head = `super_admin`** — tài khoản đầu tiên (seed), toàn quyền hệ thống/user/cơ sở/cấu hình.
- **Kinh Doanh head = role mới `giam_doc_kinh_doanh`** — quản lý + tạo đội KD (sale, cskh, ctv_mkt); xem CRM/CSKH/Finance.
- **Giáo Dục head = role mới `giam_doc_dao_tao`** — quản lý + tạo đội đào tạo (giao_vien, head_teacher); xem academic/lớp/grading.
- **Delegated user.create**: super_admin tạo mọi role; 2 director tạo CHỈ role thuộc nhóm mình + trong cơ sở mình (RLS lo facility; thêm guard nhóm-role).

## Các wave
- **W1 (đang chạy) — Verify thực tế + devops (song song):** flow-verifier theo domain (curl thật + check server log), devops đánh giá cấu hình/best-practice, bootstrap-designer chốt chi tiết 3-heads + reset/seed + guide.
- **W2 — Triển khai:** thêm 2 role + delegated create + UI user-mgmt; retire apps/teaching; fix issue W1 tìm ra.
- **W3 — Build prod-like + reset/seed + guide:** docker/compose full local, reset DB sạch, seed CHỈ IT head, viết lại operate guide theo 3-heads, test thật có log → reset cho user.
- **W4 — Commit, push develop, đóng nhánh.**

## Acceptance
- build full local chạy được (api+admin+lms) như prod; health xanh.
- login IT head → tạo 2 director → director tạo giáo viên/sale (delegated) chạy thật, có log.
- E2E + integration xanh; server log không lỗi trong các flow chính.
- DB reset sạch, chỉ còn tài khoản khởi tạo; guide khớp thao tác thật.
