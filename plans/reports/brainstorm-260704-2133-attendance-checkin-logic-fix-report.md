# Brainstorm — Sửa logic chấm công (check-in/out) đúng thiết kế gốc

- **Ngày**: 2026-07-04
- **Nhánh**: develop
- **Lane (FEATURE_INTAKE)**: HIGH-RISK (đụng data model + hành vi đã có + hợp đồng API + luồng duyệt/authorization)
- **Phạm vi**: chỉ dựng plan (Brainstorm → Plan → Red-team → validate). KHÔNG implement.
- **Flags**: (none)

---

## 1. Bối cảnh & sự cố phát hiện khi scout

> ⚠️ Khi mở phiên, toàn bộ `apps/api/` (377 file, gồm backend chấm công) bị **xóa khỏi working tree** nhưng còn nguyên trong Git HEAD. Đã `git restore` khôi phục 100%. Không mất dữ liệu.

Code liên quan (đã đọc từ HEAD + sau khôi phục):

- `apps/api/src/routers/check-in-out.ts` — API `punch`, `todayStatus`, `checkIP`, `pendingManual`, `approveManual`, `history`, `monthlyReport`.
- `apps/api/src/lib/attendance-penalty.ts` — chuẩn ICT (GMT+7), `ictDayRangeFor()`, phạt muộn/sớm, `summarizeAttendance`.
- `apps/admin/src/checkin-panel.tsx` — UI đồng hồ, nút CHECK-IN/OUT, lịch sử hôm nay, lịch sử 14 ngày, bảng duyệt manager.
- `packages/db/prisma/schema.prisma` — `model TimePunch` (có sẵn `approvedById/approvedAt`, `method`).

---

## 2. Yêu cầu gốc (chốt lại)

| # | Yêu cầu | Trạng thái hiện tại |
| --- | --- | --- |
| 1 | Bấm nhiều lần trong ngày; hệ chỉ lấy **lần đầu = giờ vào**, **lần cuối = giờ ra** (tự nhận diện). Nút ẩn 5s rồi hiện lại. | Server đã lấy first+last, NHƯNG UI khóa nút sau lần bấm thứ 2 → không ghi được giờ ra thật. Debounce server 30s (mô tả là 5s). |
| 2 | Chấm ngoài WiFi công ty → xổ ô **nhập lý do**, lưu thành **phiếu**, chỉ nhập **1 lần đầu tiên/ngày**. | CHƯA CÓ: không ô lý do, không phiếu; mỗi punch manual là 1 dòng chờ duyệt riêng. |
| 3 | Qua ngày mới **reset**, tránh ghi vào ngày cũ / dính phiếu ca cũ. | Cơ bản có (lọc theo ngày ICT). Rủi ro: phiếu-lý-do phải khóa theo ngày; ca đêm vắt nửa đêm; biên UTC↔ICT. |
| 4 | Rà thông tin nhạy cảm khi hiển thị (vd IP). | Banner đã bỏ IP (plan cũ). CÒN SÓT: bảng "Lịch sử 14 ngày" của chính nhân viên vẫn in IP thô. |

## 3. Quyết định của người dùng (đã chốt qua Q&A)

1. **Khôi phục code ngay** — ĐÃ LÀM (`git restore`).
2. **Phiếu theo NGÀY, duyệt 1 lần** — 1 phiếu/người/ngày; nhập lý do 1 lần; manager duyệt 1 lần là hợp lệ cả ngày.
3. **Luôn cho bấm cả ngày** — lần đầu = giờ vào; mọi lần sau = cập nhật giờ ra = lần cuối. Nút ẩn 5s rồi hiện lại.
4. **Bỏ hẳn cột IP ở màn nhân viên** — nhân viên chỉ thấy ngày/giờ/phương thức; manager vẫn thấy IP ở bảng duyệt.

---

## 4. Thiết kế giải pháp (đồng thuận)

### 4.1 Model phiếu chấm-ngoài-WiFi (mới)

```prisma
model ManualAttendanceTicket {
  id           String    @id @default(uuid()) @db.Uuid
  facilityId   Int       @map("facility_id")
  userId       String    @map("user_id") @db.Uuid
  dateKey      String    @map("date_key")     /// "YYYY-MM-DD" theo ICT — khóa theo ngày
  reason       String                          /// lý do nhập 1 lần đầu ngày
  status       String    @default("pending")   /// pending | approved
  approvedById String?   @map("approved_by_id") @db.Uuid
  approvedAt   DateTime? @map("approved_at")
  createdAt    DateTime  @default(now()) @map("created_at")

  @@unique([userId, dateKey])   /// đảm bảo 1 phiếu/người/ngày
  @@index([facilityId, status])
  @@map("manual_attendance_ticket")
}
```

- **Lý do 1 lần/ngày**: `@@unique([userId, dateKey])`. Punch manual đầu tiên trong ngày tạo phiếu + yêu cầu lý do; các punch manual sau cùng ngày gắn vào phiếu có sẵn, KHÔNG hỏi lại.
- **Duyệt 1 lần**: manager duyệt phiếu → coi như duyệt toàn bộ punch manual của người đó trong ngày.

### 4.2 Luồng `punch` (server) — mới

1. Advisory lock + debounce (đổi 30s → **5s** cho khớp UX).
2. Xác định `ipAllowed` như hiện tại.
3. Nếu **ngoài WiFi**:
   - Tìm phiếu `(userId, dateKey)` hôm nay. Nếu **chưa có** → API trả cờ `requiresReason: true` (chưa tạo punch), UI xổ dialog nhập lý do → gọi `punch({ reason })` để tạo phiếu + punch.
   - Nếu **đã có phiếu** → tạo punch manual gắn phiếu, không hỏi lý do.
4. Nếu **trong WiFi** → tạo punch `ip` như cũ.
5. Không đổi cách `todayStatus` suy ra first/last.

> Ghi chú hợp đồng API: `punch` sẽ nhận input tùy chọn `{ reason?: string }` và có thể trả `requiresReason` — đây là **thay đổi public contract**, cần cập nhật cả `checkin-panel.tsx`.

### 4.3 Duyệt (approve) — chuyển từ per-punch sang per-ticket

- `pendingManual` → liệt kê **phiếu** pending (kèm lý do, số lần bấm, ca).
- `approveManual` → duyệt **phiếu**: set `status=approved`; đồng thời stamp `approvedAt` lên tất cả punch manual của user+ngày (giữ nguyên logic `monthlyReport` hiện đọc `punch.approvedAt`, tránh phải sửa report). Punch manual tạo thêm sau khi phiếu đã duyệt → auto-approved.
- Giữ `assertCanApprovePunch` (manager trực tiếp / HR / super admin; không tự duyệt).

### 4.4 UX bấm cả ngày (req#1)

- Bỏ nhánh `isCompleted` ẩn nút. Nút hiển thị suốt ngày:
  - Chưa có punch → "CHECK-IN" (xanh).
  - Đã có ≥1 punch → "CHECK-OUT / Cập nhật giờ về" (đỏ).
- Sau mỗi lần bấm: hiện xác nhận trên màn (giờ vừa ghi) → ẩn nút **5s** → hiện lại (khớp mô tả UX gốc).
- Debounce server 5s là chốt chặn double-submit; UX 5s là lớp phủ.

### 4.5 Reset theo ngày (req#3)

- Mọi truy vấn hôm nay dùng `ictDayRangeFor()` (đã đúng ICT). Phiếu khóa bằng `dateKey` ICT → sang ngày mới `todayStatus` rỗng, phiếu cũ không dính.
- Validation cần thêm: test biên nửa đêm ICT (23:59 → 00:01), và xác nhận ca đêm vắt nửa đêm **ngoài phạm vi** (ghi rõ giả định).

### 4.6 Che IP (req#4)

- `checkin-panel.tsx`: bỏ cột IP khỏi bảng "Lịch sử 14 ngày" (màn nhân viên tự xem). Giữ cột ngày/giờ/phương thức.
- Giữ IP ở bảng duyệt manager (audit hợp lệ).

---

## 5. Phân rã plan (khối lượng lớn → tách 3)

| Plan | Slug | Nội dung | Rủi ro | Phụ thuộc |
| --- | --- | --- | --- | --- |
| **A** | `attendance-manual-ticket-reason` | Model `ManualAttendanceTicket` + migration; `punch` yêu cầu lý do 1 lần/ngày; chuyển duyệt sang per-ticket; cập nhật `pendingManual`/`approveManual` + UI dialog lý do + bảng duyệt phiếu | **HIGH** (DB, migration, authorization, public contract) | — |
| **B** | `attendance-allday-punch-ux` | Bỏ khóa `isCompleted`; nút bấm cả ngày; debounce 30s→5s; UX ẩn-5s-hiện-lại; verify reset theo ngày (test biên nửa đêm) | Vừa | Độc lập A (có thể song song; đụng cùng file `check-in-out.ts`+`checkin-panel.tsx` → nếu làm song song phải phối hợp merge) |
| **C** | `attendance-hide-ip-staff-view` | Bỏ cột IP ở "Lịch sử 14 ngày" màn nhân viên | Thấp | Có thể gộp vào B |

**Khuyến nghị thứ tự**: A trước (schema là nền), rồi B, C gộp vào B. Vì A và B cùng sửa `check-in-out.ts` + `checkin-panel.tsx`, **không làm song song** để tránh xung đột file — làm tuần tự A → B(+C).

---

## 6. Rủi ro & giảm thiểu

| Rủi ro | Giảm thiểu |
| --- | --- |
| Migration bảng mới trên prod (chain migration nhạy — từng có lỗi migrate-staleness) | Migration thuần thêm bảng, không đụng bảng cũ; test trên dev trước; kèm rollback (drop table). |
| Đổi public contract `punch` (thêm reason/requiresReason) | Cập nhật đồng bộ FE+BE trong cùng plan A; giữ backward: input reason optional. |
| Đổi ngữ nghĩa duyệt (per-punch → per-ticket) làm lệch `monthlyReport` | Stamp `approvedAt` lên punch khi duyệt phiếu → report cũ vẫn chạy, không sửa report. |
| Bỏ khóa completed cho phép bấm vô hạn → nhiều row rác | Giữ debounce 5s; report vẫn chỉ lấy first/last nên không sai số liệu. |
| Ca đêm vắt nửa đêm | Ghi rõ ngoài phạm vi; test biên ICT. |

## 7. Tiêu chí nghiệm thu (chung)

- [ ] Bấm nhiều lần/ngày: `todayStatus` luôn = (lần đầu, lần cuối); nút không biến mất sau check-out.
- [ ] Ngoài WiFi lần đầu/ngày: xổ dialog lý do; lần sau cùng ngày không hỏi lại; lưu 1 phiếu.
- [ ] Manager duyệt phiếu 1 lần → cả ngày hợp lệ; `monthlyReport` tính đúng.
- [ ] Sang ngày mới: trạng thái reset, không dính phiếu/ca ngày cũ (test biên nửa đêm ICT).
- [ ] Màn nhân viên không lộ IP; bảng manager vẫn có IP.
- [ ] `pnpm --filter @cmc/api typecheck` + `@cmc/admin typecheck` sạch; test chấm công xanh.

## 8. Câu hỏi còn mở

- Ca đêm vắt qua nửa đêm ICT — xác nhận **ngoài phạm vi** đợt này? (giả định: có).
- Khi manager **từ chối** phiếu ngoài WiFi thì punch xử lý sao (loại khỏi công / đánh dấu rejected)? Hiện chỉ có "duyệt", chưa có "từ chối" — cần chốt ở Plan A.
- Debounce đổi 30s→5s có ảnh hưởng chống spam không? (đánh giá ở Plan B).
