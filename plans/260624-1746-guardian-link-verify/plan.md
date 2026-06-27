# Plan — T15·Guardian: khóa bất biến A3 (PH thấy đúng con mình)

> Lập 2026-06-24. Lát cắt Phase 5 đầu tiên (operator chốt: Guardian-link trước).
> **Phát hiện trung thực sau scout:** feature Guardian-link **đã build end-to-end** —
> không phải build mới. Việc còn lại = **khóa bất biến bảo mật A3 bằng int-test thật**
> (đang là weak-proof). Lane: high-risk (security-class authorization) → mutation-proof + 2-agent review.

## Hiện trạng đã verify (scout 2026-06-24)
| Lớp | Tình trạng | Chứng cứ |
|---|---|---|
| Schema `Guardian`/`ParentAccount`/`StudentAccount` + `@@unique(parentAccountId, studentId)` | ✅ có | `schema.prisma:415-465` |
| RLS principal-aware (GUC `app.principal_kind`+`app.student_ids`) | ✅ có (Phase 2) | spec phase-02 §2 |
| Router `guardian` (parentList/parentCreate/listForStudent/link/unlink + audit, role-gate bgd/quan_ly/super) | ✅ có | `routers/guardian.ts` |
| Parent session resolve **tất cả** con qua guardians → studentIds/facilityIds | ✅ có | `packages/auth/src/lms.ts:34-54` |
| UI admin quản lý link | ✅ có | `apps/admin/src/guardians-panel.tsx` |
| UI LMS phụ huynh "thấy đủ con" (selector + dashboard/con + lịch họp gộp) | ✅ có | `apps/lms/src/parent-view.tsx` |
| **Int-test bất biến guardian/principal** | ❌ **THIẾU** | `apps/api/test/` không có file guardian/principal-isolation |

## Gap = bất biến A3 chưa có bằng chứng
Done-evidence roadmap: *"phụ huynh thấy **đủ** con"* + (ngầm bảo mật) *"thấy **đúng** con, không thấy con người khác / không xuyên facility"*.
Code thực thi điều này, nhưng **không test nào khóa lại** → hồi quy âm thầm (ai đó bỏ filter guardian / nới principal policy) sẽ không bị bắt.

## Slice (1 việc, 1 file test)
`apps/api/test/guardian-principal-isolation.int.test.ts` — caller thật + DB thật + RLS thật. Dùng `lmsCaller`/`staffCaller` từ `helpers.ts`. Theo style `level-progress-authz.int.test.ts` (negative-proof: principal lạ → bị chặn; đọc lại state từ DB).

### Ma trận bất biến (mỗi dòng ≥1 assertion)
| # | Bất biến | Cách chứng |
|---|---|---|
| G1 | PH P (link S1,S2) → `loginParent`/`parentSession` trả **đúng {S1,S2}**, KHÔNG S3 | so khớp tập studentIds; thêm S3 của PH khác để chứng cô lập |
| G2 | `lmsCaller(P)` đọc dữ liệu **con mình** (gradebook / submission.forStudent / rewards.balance / levelProgress.forStudent / parentMeeting.myMeetings của S1) → OK | có data |
| G3 | `lmsCaller(P)` đọc **con người khác** (cùng query với S3) → **bị chặn** (FORBIDDEN/rỗng theo RLS) | assert chặn cho TỪNG query trên |
| G4 | Xuyên facility: P link S1@fac1 + S2@fac2 → thấy **cả hai**; vẫn KHÔNG thấy non-child S4 ở fac1/fac2 | studentIds = {S1,S2}; G3 áp cho S4 |
| G5 | `link`/`unlink` đổi đúng tập con: link P→S3 → re-resolve thấy S3; unlink → mất | re-run `parentSession` đọc DB |
| G6 | Role-gate: `giao_vien` gọi `guardian.parentList`/`guardian.link` → FORBIDDEN; `bgd` được | staffCaller 2 vai |

### Quy tắc thực thi (verified-execution)
- **Nếu G3 lọt** (PH đọc được con người khác ở BẤT KỲ query nào) → **DỪNG, báo là defect bảo mật thật** (A3 chưa kín), KHÔNG sửa test cho qua. Đó là phát hiện, không phải coverage.
- Mutation-sense: mỗi assert "bị chặn" phải fail đúng chỗ nếu filter principal bị bỏ. Nếu một query không có cơ chế principal-ownership → ghi rõ trong report (có thể là gap cần slice phụ).
- Tự chạy: `pnpm --filter @cmc/api test:int` (hoặc chạy riêng file) → dán PASS thật. Full int-suite phải xanh (không hồi quy 40/40).
- FK-safe cleanup ở `afterAll` (notification/guardian/student_account/parent_account/student theo thứ tự FK).

## Bất biến tổng
- A3 kín: phạm vi PH suy từ `Guardian` ở DB, không từ input client. Xuyên facility chặn. PH↔PH chặn.
- 0 đụng `apps/api/src` business code trừ khi G3 lộ defect (khi đó: slice phụ + plan cập nhật).

## Rủi ro / rollback
- Chỉ thêm 1 file test → 0 rủi ro runtime. Nếu lộ defect bảo mật → nâng thành high-risk fix (router/RLS), 2-agent review riêng.

## Đóng việc (gate)
1. File test PASS thật (dán output) + full int-suite xanh + typecheck + `pnpm -r lint`.
2. **2-agent review** (security-class): 1 correctness (test có "răng"/mutation-sense), 1 business (ma trận đủ phủ A3) → SAFE-TO-CLOSE.
3. Cập nhật backlog T15 + roadmap Phase 5 (Guardian = done-by-evidence).

## Phân công model (theo chỉ đạo operator)
- Plan/điều phối/review-verify: **Opus** (controller).
- Viết int-test: **ck tester-agent · Sonnet 4.6** (security-class, cần cẩn trọng logic).
- 2-agent review: **ck code-reviewer ×2 · Sonnet 4.6**.

## Câu hỏi mở
- Các query parent-portal (gradebook/submission/rewards/myMeetings) đã thực sự gate theo `app.student_ids` chưa, hay chỉ facility? → test G3 sẽ trả lời bằng bằng chứng.

## Trạng thái thực thi
- **V1 (2026-06-24)**: tester-agent (Sonnet) tạo `guardian-principal-isolation.int.test.ts` 22 case, full int-suite 68 PASS, typecheck+lint xanh. Báo "A3 kín".
- **2-agent review (Sonnet) — DONE_WITH_CONCERNS**, kết luận "A3 kín" là **sớm**:
  - Correctness: M1 G1/G5 mirror `parentSession` thay vì gọi `loginParent` thật → không bắt hồi quy resolver; m1/m2 G3-myMeetings + G3-submission rỗng-tuếch (không seed data S3).
  - Coverage: chỉ 5/11 surface phụ huynh chạm tới có test G3. Bỏ sót `badge.myBadges` (F1), `leaderboard.forStudent` (F2), `notification.list/unreadCount` (F3). myMeetings rỗng (F4).
  - Reports: `from-code-reviewer-correctness-260624-1746-guardian-a3-test-teeth-review-report.md`, `from-code-reviewer-coverage-260624-1746-guardian-a3-coverage-audit-report.md`.
- **V2 (đang vá, Sonnet)**: M1 + 4 surface bổ sung (submission có data, badge, leaderboard, notification) + myMeetings có răng. DEFER slice riêng: F5 SSE `/sse/notifications`, F6 student-self isolation.
- Gate đóng: V2 pass thật + full suite xanh + 11/11 surface (trừ 2 defer ghi rõ) → mới SAFE-TO-CLOSE.
- **V2 (2026-06-24) — ✅ ĐÓNG, SAFE-TO-CLOSE.** 26 case, controller tự chạy full int-suite **72 PASS (19 file, 0 hồi quy)**, `@cmc/api` typecheck + lint sạch. Đã verify: G1/G5 gọi `loginParent` thật (bỏ mirror); G3 seed đủ S3 data cho 8 surface (gradebook/qualitative/submission/balance/levelProgress/badge/notification/leaderboard) + myMeetings có răng; `git status` chỉ thêm file test (0 đụng `apps/api/src`/`packages`). A3 **kín** (PH thấy đúng+đủ con, chặn con người khác + xuyên facility). Report: `tester-260624-1822-...-v2-report.md`.
- **DEFER (slice riêng, đã ghi comment trong test):** F5 SSE `/sse/notifications` isolation (cần vehicle test khác), F6 student-self principal isolation (ngoài scope guardian-link).
- **Phase 5 còn lại:** After-sale + lifecycle, Dashboard BGĐ/MAES, Certificate auto-gen.
