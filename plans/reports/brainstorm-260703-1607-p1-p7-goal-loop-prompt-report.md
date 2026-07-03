# Brainstorm: prompt cho /loop tự triển khai P1-P7

**Ngày**: 2026-07-03
**Kích hoạt bởi**: user cần 1 prompt để chạy `/loop` (không interval, tự pace) triển khai 7 plan ERP UI rebuild đã red-team xong, tuân thủ harness Brainstorm→Plan→Red-team→Implement→Review→Test→Audit→Fix.

## Quyết định (mặc định an toàn, không hỏi thêm theo yêu cầu)

- Loop **dừng lại hỏi qua AskUserQuestion** khi gặp quyết định ảnh hưởng nhiều plan sau (như 2 câu P1 đang treo) — không tự đoán. An toàn hơn tốc độ.
- Tôn trọng thứ tự phụ thuộc: P1 trước hết → P2+P3 song song → P4-P7 song song.
- Mỗi plan qua đủ chuỗi: Plan (đã có, chỉ review lại) → Red-team (đã có cho P1, plan khác làm khi tới lượt) → Implement → Review (code-reviewer subagent) → Test → Audit (gitnexus detect_changes) → Fix nếu cần.

## Prompt để chạy `/loop` (copy nguyên văn dùng)

```
Triển khai tuần tự 7 plan ERP UI rebuild tại D:\project\CMCnew\plans\260703-1549-p1-*
đến 260703-1549-p7-*. Tuân thủ harness đầy đủ cho MỖI plan: Plan (đã có, review lại
trước khi code) → Red-team (nếu plan chưa được red-team, chạy trước implement — P1 đã
xong, P2-P7 chưa) → Implement → Review (spawn code-reviewer subagent bắt buộc) → Test
(chạy pnpm -w typecheck + test suite liên quan) → Audit (gitnexus_detect_changes xác
nhận scope thay đổi khớp plan) → Fix nếu review/test/audit phát hiện vấn đề.

Thứ tự bắt buộc theo dependency graph:
1. P1 (token remap) — làm trước tiên, không phụ thuộc gì. TRƯỚC KHI CODE: xác nhận 2
   Unresolved Question trong P1/plan.md (dropdown/menu/modal giữ shadow hay flatten;
   Modal accessibility) — nếu chưa có câu trả lời, DỪNG LẠI dùng AskUserQuestion hỏi
   tôi, không tự đoán.
2. Sau khi P1 commit xong: P2 (record-detail primitive) và P3 (calendar-view
   primitive) chạy SONG SONG (file độc lập, đã xác nhận qua structural audit).
3. Sau khi P2+P3 commit xong: P4, P5, P6, P7 chạy SONG SONG (đã xác nhận độc lập file,
   nhưng P4 có soft-dependency vào P7's DataTable/ViewSwitcher interface — nếu chạy
   song song thật, land P7 trước hoặc kiểm tra interface P7 ổn định trước khi P4 động
   vào phần DataTable/ViewSwitcher).

Với MỌI plan, trước khi implement:
- Đọc lại plan.md + phase file, xác nhận Acceptance Criteria còn hợp lệ.
- Nếu plan chưa qua red-team (P2-P7 hiện tại), spawn code-reviewer subagent red-team
  plan trước — dùng đúng pattern đã áp dụng cho P1 (xem
  plans/260703-1549-p1-token-remap-zero-elevation/reports/ để tham khảo format).
- Áp fix từ red-team vào plan.md/phase file TRƯỚC KHI code, không code song song với
  red-team.

Sau implement mỗi plan:
- Spawn code-reviewer subagent bắt buộc — check acceptance criteria, regression,
  breaking contract, pattern-match với scout, lint/type sạch.
- Nếu review flag vấn đề: dừng, dùng AskUserQuestion trình bày 2-4 option cho tôi
  chọn (theo HARD-GATE-NO-SIDE-EFFECTS), không tự sửa im lặng.
- Chạy pnpm -w typecheck + test suite liên quan (packages/ui, apps/admin theo module
  plan đó chạm).
- Chạy gitnexus_detect_changes(scope: all) xác nhận file thay đổi khớp đúng phạm vi
  plan khai báo — không có file ngoài dự kiến.
- Commit riêng từng plan (không gộp nhiều plan 1 commit), message theo conventional
  commit, không cần xin phép commit mỗi lần (đã được ủy quyền qua /loop này) NHƯNG
  dừng lại hỏi nếu bất kỳ thay đổi nào chạm tới auth/schema/API contract ngoài phạm
  vi UI đã khai báo trong 7 plan.

Dừng lại hỏi tôi (không tự quyết) khi:
- Gặp quyết định ảnh hưởng ≥2 plan sau (như shadow doctrine của P1).
- Review/test/audit phát hiện regression hoặc side-effect ngoài dự kiến.
- Plan cần sửa đổi phạm vi đáng kể so với bản đã viết (không phải fix nhỏ từ
  red-team).

Sau khi cả 7 plan xong: chạy /ck:project-management sync-back trạng thái tất cả plan,
viết journal tổng kết, KHÔNG tự mở PR/merge — dừng lại hỏi tôi bước cuối.
```

## Vì sao prompt này, không phải bản khác

- **Không giao toàn quyền quyết định tự động** — Zero Elevation đổi token dùng chung cho toàn hệ thống, đoán sai ở P1 sẽ lan ra cả P2-P7 không cách nào rollback rẻ. Dừng hỏi khi cần là đánh đổi tốc độ lấy an toàn, hợp lý cho quy mô đổi UI toàn ERP.
- **Không code song song P1 với red-team** — pattern đã dùng cho P1 (red-team → fix plan → mới code) chứng minh hiệu quả (tìm ra 8 vấn đề thật trước khi code 1 dòng nào).
- **Không tự commit gộp nhiều plan** — mỗi plan 1 commit giữ lịch sử rõ, dễ revert riêng nếu 1 plan có vấn đề mà không ảnh hưởng plan khác.

## Next steps

Chạy `/loop` với prompt trên (không cần interval — để model tự pace theo hướng dẫn ScheduleWakeup nội bộ). Loop sẽ dừng lại ngay từ bước đầu (P1) để hỏi 2 câu shadow doctrine — trả lời khi đó.

## Unresolved Questions

Không còn — đây là artifact/prompt, không phải quyết định thiết kế mới cần chốt.
