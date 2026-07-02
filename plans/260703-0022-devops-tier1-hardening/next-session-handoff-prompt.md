# Handoff prompt — paste this to start the new session

Trước khi làm bất kỳ việc gì, đọc memory `autonomous-devops-email-rollout-setup-260703.md` (auto
memory system, type: project) để lấy đầy đủ bối cảnh: thứ tự thực thi, checkpoint cần người thật,
cách deploy/verify hoạt động. Đừng hỏi lại tôi bất kỳ câu nào về approach/design — mọi quyết định đã
chốt và ghi trong 3 plan dưới đây (mỗi plan đã qua đủ vòng scout → research → plan → red-team →
validate, 0 unresolved contradiction). Nếu gặp ambiguity nhỏ khi code mà plan chưa lường tới, tự
research/grep codebase/áp dụng YAGNI-KISS-DRY rồi quyết luôn, ghi lại lý do — không dừng lại hỏi.

## Mục tiêu phiên này

Triển khai đầy đủ, tự động, loop tới khi xong, theo đúng thứ tự:

1. `plans/260703-0022-devops-tier1-hardening/plan.md` — chạy `/ck:cook <path> --auto` trước tiên.
   Sau khi land xong, PHẢI hoàn thành soak 48h (Phase 4) trước khi đụng tới plan #2 — không bỏ qua.
2. `plans/260703-0052-dev-prod-cicd-environments/plan.md` — CHỈ bắt đầu sau khi #1 đã soak xong
   trên prod thật (kiểm tra `status:` trong frontmatter của plan #1 trước khi động vào plan này).
3. `plans/260702-2352-email-brevo-external-routing/plan.md` — độc lập file-wise với #1/#2, có thể
   chạy song song hoặc xen kẽ bất cứ lúc nào.

Với mỗi plan: implement → test → review (code-reviewer subagent bắt buộc) → push lên branch riêng →
mở PR → chờ Jenkins required-check xanh → merge → nếu plan có bước deploy dev (chỉ #2 có) thì verify
dev trước (`curl` health-check, so commit marker) → merge tiếp lên `main` → verify prod (`curl`
health-check erp/hoc). Deploy là tự động qua Jenkins khi push/merge — KHÔNG cần SSH trực tiếp vào VPS
cho bước deploy, chỉ cần `git`/`gh`/`curl`.

## Nguyên tắc autonomous — không hỏi lại, TRỪ 4 checkpoint sau

Các checkpoint này không phải "câu hỏi" mà là hành động chỉ người thật làm được (không có credential
trong repo): đăng ký Entra redirect URI (Azure AD portal), xác nhận Cloudflare SSL mode + Origin Cert
(dashboard/API, không có `CF_API_TOKEN`), lấy Entra client secret cho dev app registration, đăng nhập
SSO qua trình duyệt thật (MFA). Khi chạm tới 1 trong 4 cái này ở plan #2 Phase 1/5: dừng đúng bước đó,
ghi rõ cần làm gì, tiếp tục làm phần việc khác không bị block, KHÔNG coi cả phiên là fail.

Nếu phiên này có quyền truy cập VPS/SSH thật, các pre-flight thao tác VPS (rebuild Jenkins plugin,
đọc cert issuer, `docker inspect`) trong plan #1 Phase 3/4 vẫn tự làm được — không phải checkpoint
chặn nếu có quyền truy cập; chỉ chặn nếu phiên này KHÔNG có VPS access.

## An toàn vẫn phải giữ

Tôi đã cho phép trước toàn bộ chuỗi "test dev → PR → main → verify prod" này — không cần hỏi lại "có
chắc muốn deploy prod không". Nhưng vẫn tuân thủ: rollback procedure ghi sẵn trong từng phase file
khi có lỗi (không tự sáng tác cách khác), không force-push, không skip hook, luôn tạo commit mới
(không amend), chạy `gitnexus_impact` trước khi sửa symbol theo đúng CLAUDE.md của repo, không commit
secret.

Bắt đầu bằng việc đọc memory trên, sau đó đọc `plan.md` của cả 3 plan (không cần đọc lại từng
phase file ngay — đọc phase file khi tới lượt implement phase đó), rồi bắt tay vào plan #1.
