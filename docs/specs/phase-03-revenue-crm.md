# Phase 3 — Đặc tả nghiệp vụ: Doanh thu & CRM

> **Mục đích:** chốt nghiệp vụ TRƯỚC khi code (spec-first). Hợp đồng nghiệp vụ — mọi schema/route bám đúng. Phát sinh mơ hồ MỚI khi build → DỪNG và hỏi.
> Trạng thái: ✅ **ĐÃ CHỐT** (2026-06-23) · Nguồn: `project-charter.md` §4 + audit hệ cũ (M2 voucher) + 4 quyết định phỏng vấn (2026-06-23).

## Tóm tắt quyết định đã chốt
- **Phạm vi:** spec bao trùm toàn Phase 3, **build theo lát cắt dọc**. Slice đầu = giá khóa effective-dated → phiếu thu (draft→approve) với **discount + voucher nguyên tử** (sửa lỗi M2 hệ cũ — done-evidence chính của phase).
- **CRM pipeline O1→O5:** O1 lead → O2 contacted (manual) → **O3 đặt lịch test (auto-hook khi tạo lịch hẹn test)** → **O4 đã test (auto-hook khi chấm xong điểm test)** → O5 nhập học (manual close-won). **1 opportunity = 1 học sinh / 1 SĐT.**
- **Giảm giá:** tier cố định **15%/20%/30%** theo **1/2/3 năm** đóng trước; cộng với voucher; **trần tổng 35%** — chính sách **cộng dồn rồi cap về 35%** (không từ chối khách, không lố trần).
- **Voucher:** scope **theo cơ sở (facility)**; **multi-use** (`maxUses`, single-use = maxUses 1); consume **nguyên tử** tại `receipt.approve` (`WHERE used_count < max_uses`, 0-row = CONFLICT). Refund (nhả 1 lượt) khi phiếu thu bị hủy sau approve.
- **Giá khóa:** `CoursePrice` **effective-dated**; giá chốt cho 1 phiếu thu = giá có hiệu lực tại **ngày lập phiếu thu**.
- **Phiếu thu:** vòng đời `draft → approved → sent → (reconciled)`; có thể `cancelled`. KHÔNG thanh toán online (charter) — "send" = đánh dấu đã gửi + xuất PDF; reconciliation = đối soát thủ công với sổ tiền mặt/ngân hàng.
- **RLS bắt buộc** mọi bảng tenant; logic tiền **thuần** ở `packages/domain-finance` (test độc lập); giờ chuẩn ICT; soft-delete/archive; audit/chatter mọi mutation trạng thái.

---

## 0. Phạm vi Phase 3

### Trong phạm vi
- **CRM:** `Contact`, `Opportunity` (stage O1–O5 + transition có audit), **lead-ingest seam** (endpoint nhận lead cho website sau).
- **Test:** `TestAppointment` (entrance/periodic) + kết quả → auto-hook O3/O4.
- **Tài chính:** `CoursePrice` (effective-dated), `DiscountTier` (config), `Voucher`, `Receipt` (+ dòng phiếu), `Reconciliation`.
- **Config:** quản lý bảng giá / discount tier / voucher.

### Ngoài phạm vi (phase sau)
- Thanh toán online (VietQR/PayOS), hóa đơn điện tử, auto-invoice cron — charter loại trừ.
- Lương/HR → Phase 4. After-sale/guardian-exec → Phase 5.
- Website marketing tự gọi lead-ingest → chỉ chuẩn bị seam, không tích hợp thật ở Phase 3.

### Lộ trình build (slice dọc, mỗi slice chạy được + done-evidence thật)
- **S1 — Lõi doanh thu:** `CoursePrice` effective-dated + `DiscountTier` + `Voucher` + `Receipt` draft→approve. Tại approve: tính giá (ngày lập) → cộng discount tier + voucher → cap 35% → **trừ voucher nguyên tử**. *Done:* lập phiếu → duyệt → voucher đơn-dùng không over-consume (2 request đua → 1 OK, 1 CONFLICT); tổng giảm không vượt 35%.
- **S2 — CRM pipeline:** `Contact` + `Opportunity` O1–O5 + stage transition (audit) + lead-ingest seam. Liên kết O5→`Enrollment` (qua `Enrollment.opportunityId` seam Phase 1). *Done:* lead → O1→O5 → enrollment; lùi/re-open ghi audit.
- **S3 — Test & auto-hook:** `TestAppointment` (entrance/periodic) + nhập kết quả → auto O3 (tạo lịch) / O4 (chấm xong). *Done:* tạo lịch test → opp tự lên O3; chấm xong → tự lên O4.
- **S4 — Phiếu thu render/send + reconciliation:** xuất PDF phiếu thu (tái dùng hạ tầng flatten Phase 2) + đánh dấu sent + đối soát thủ công. *Done:* phiếu approved → render PDF tải được → mark sent → reconcile.

---

## 1. Bất biến tenancy & quyền
- Mọi bảng Phase 3 (`Contact`, `Opportunity`, `Receipt`, `Voucher`, …) mang `facilityId` + **RLS facility-scoped** (staff thấy theo `facility_ids`; super_admin bypass). PH/HS không truy cập (CRM/tài chính là app Teaching/Admin).
- **Quyền (theo charter §3):**
  - `ke_toan`: tạo/duyệt phiếu thu, dùng voucher/discount.
  - `sale`/`cskh`: CRM (contact/opportunity/lead), tạo lịch test.
  - `quan_ly` + `ke_toan` + `super_admin`: config bảng giá / discount tier / voucher (cấp cơ sở).
  - `giao_vien`: chấm điểm test (auto-hook O4) — không đụng tài chính.

---

## 2. Thực thể & vòng đời

### 2.1 Contact — facility-scoped
- Người liên hệ/khách tiềm năng: `fullName`, `phone` (chuẩn hóa E.164/`+84`), `email?`, `source?` (web/walk-in/referral), `note?`. Soft-delete.
- **Dedup:** `phone` chuẩn hóa là khóa nhận diện trong cơ sở.

### 2.2 Opportunity — facility-scoped
- `contactId`, `studentName?` (HS dự kiến), `program?`, `stage` (`O1_LEAD`|`O2_CONTACTED`|`O3_TEST_SCHEDULED`|`O4_TESTED`|`O5_ENROLLED`), `lostReason?`, `closedAt?`.
- **1 opportunity = 1 HS / 1 SĐT** (ràng buộc nghiệp vụ; nhiều con cùng SĐT → nhiều opportunity, phân biệt bởi `studentName`).
- **Transition:** O1→O2→O3→O4→O5 (tiến); cho **lùi stage / re-open** (vd O5→O2) — **mọi transition ghi `record_event`** (cũ→mới + actor + lý do). O3/O4 set bởi auto-hook (§2.5); O2/O5 manual.
- Liên kết kết quả: O5 close-won → tạo/nối `Enrollment` qua `Enrollment.opportunityId` (seam Phase 1).

### 2.3 CoursePrice — effective-dated, facility-scoped
- `(courseId, facilityId, effectiveFrom)` → `amount`. Giá áp cho phiếu = bản ghi có `effectiveFrom ≤ ngày lập phiếu` mới nhất.
- Không sửa bản ghi cũ; đổi giá = thêm bản ghi `effectiveFrom` mới (audit lịch sử giá). Tạo bởi quan_ly/ke_toan/super_admin.

### 2.4 DiscountTier — config theo cơ sở
- Map **số năm đóng trước → % giảm**: 1→15, 2→20, 3→30 (seed mặc định; cho chỉnh ở config). `yearsPrepaid` là input trên phiếu thu.

### 2.5 Voucher — facility-scoped
- `code` (unique trong cơ sở), `percent` (hoặc `amount` cố định — v1 dùng `percent`), `maxUses`, `usedCount` (mặc định 0), `validFrom?`/`validTo?`, `active`.
- **Consume nguyên tử** (sửa M2): tại `receipt.approve`, trong cùng tx —
  `UPDATE voucher SET used_count = used_count + 1 WHERE id = ? AND active AND used_count < max_uses` → **0-row = CONFLICT**.
- **Refund:** `receipt.cancel` sau approve → `UPDATE voucher SET used_count = used_count - 1 WHERE id = ? AND used_count > 0` (cùng tx).

### 2.6 Receipt (Phiếu thu) — facility-scoped
- Trường: `studentId`, `courseId` (hoặc `classBatchId`), `period?`, `yearsPrepaid` (1–3), `grossAmount` (từ CoursePrice tại ngày lập), `discountTierPercent`, `voucherId?`/`voucherPercent`, **`effectiveDiscountPercent`** (= min(tier+voucher, 35)), `netAmount` (= gross × (1 − effectiveDiscount/100)), `collectedBy`, `status`, `approvedBy?`/`approvedAt?`, `sentAt?`, `reconciledAt?`, `cancelledAt?`/`cancelReason?`.
- **Vòng đời:** `draft → approved → sent → reconciled`; `cancelled` từ bất kỳ trạng thái (ghi lý do; nếu đã approve thì refund voucher).
- **Tính tiền tại approve** (atomic, một tx): (1) resolve `grossAmount` từ CoursePrice theo ngày lập; (2) `tier%` từ `yearsPrepaid`; (3) consume voucher nguyên tử → `voucher%`; (4) `effectiveDiscount = min(tier + voucher, 35)`; (5) `netAmount`; (6) set approved + audit.
- **Numbering:** mã phiếu `PT-YYYY-NNNN` nguyên tử (theo mẫu mã lớp B-YYYY-NNNN Phase 1).

### 2.7 TestAppointment — facility-scoped
- `opportunityId`, `type` (`ENTRANCE`|`PERIODIC`), `scheduledAt`, `status` (`scheduled`|`done`|`no_show`), `score?`, `gradedBy?`, `result?`.
- **Auto-hook:** tạo TestAppointment(ENTRANCE) cho 1 opportunity → opp **tự lên O3**; nhập điểm/chấm xong (`status=done` + `score`) → opp **tự lên O4** (chỉ tiến, không lùi tự động).
- Entrance test: đầu vào, ảnh hưởng quyết định nhập học/level dự kiến. Periodic: định kỳ trong quá trình học (không đổi stage opp).

### 2.8 Reconciliation
- v1 tối thiểu: `receipt.reconciledAt` + `reconcileNote?`; ke_toan đánh dấu đã đối soát với sổ tiền mặt/ngân hàng (không cổng thanh toán). Báo cáo: tổng thu theo kỳ/cơ sở.

### 2.9 Lead-ingest seam
- Endpoint nhận lead (public, rate-limited, token cơ sở) → tạo `Contact` + `Opportunity(O1_LEAD)`. Phase 3 chỉ dựng seam + test nội bộ; website tích hợp sau.

### 2.10 Audit/Chatter
- Mọi mutation trạng thái (opp transition, receipt approve/cancel/sent, voucher consume/refund, test scheduled/graded) → `record_event` (hạ tầng Phase 1). Không lưu PII nhạy cảm trong nội dung log.

---

## 3. Bất biến kỹ thuật
- RLS + policy trên **mọi** bảng có `facilityId` + test cô lập (cơ sở A không thấy/ghi cơ sở B).
- Logic tiền (resolve giá theo ngày, cộng tier+voucher, cap 35%, net) → `packages/domain-finance` **thuần**, test độc lập (không DB).
- Voucher consume **nguyên tử** (0-row = CONFLICT) tại approve; refund tại cancel — cùng tx với cập nhật phiếu.
- Course price: chọn bản hiệu lực theo ngày lập; không sửa bản ghi cũ.
- Mã phiếu `PT-YYYY-NNNN` nguyên tử (advisory lock / sequence per cơ sở-năm).
- Số tiền: integer VND (không float). Làm tròn net về đồng.
- Mọi mutation trạng thái → audit/chatter (bắt buộc). Giờ ICT; soft-delete, không xóa cứng.

---

## 4. Bảng quyết định (khóa schema)

| Mục | Quyết định |
|---|---|
| Phạm vi | Spec cả Phase 3; build slice S1→S4; S1 = giá→phiếu thu→discount+voucher atomic |
| CRM stage | O1 lead→O2 contacted(manual)→O3 đặt lịch test(auto)→O4 đã test(auto)→O5 nhập học(manual); 1 opp=1 HS/SĐT; cho lùi/re-open có audit |
| Discount+voucher | tier 15/20/30% theo 1/2/3 năm + voucher; **cộng dồn rồi cap về 35%** |
| Voucher | scope **theo cơ sở**; multi-use (maxUses); consume nguyên tử tại approve (WHERE used_count<max_uses, sửa M2); refund khi cancel |
| Course price | effective-dated; áp giá theo **ngày lập phiếu thu** |
| Phiếu thu | draft→approved→sent→reconciled (+cancelled); mã PT-YYYY-NNNN; net=gross×(1−min(tier+voucher,35)/100) |
| Auto-hook | O3 = tạo TestAppointment; O4 = chấm xong điểm test |
| Render/Send/Reconcile | KHÔNG online; render=PDF (flatten Phase 2), send=đánh dấu gửi+PDF, reconcile=đối soát thủ công |
| Quyền | ke_toan: phiếu/voucher; sale/cskh: CRM+lịch test; quan_ly/ke_toan/super_admin: config giá/discount/voucher |
| Logic tiền | `packages/domain-finance` thuần + test; VND integer |
| Ngoài Phase 3 | Thanh toán online, hóa đơn điện tử, website tích hợp thật → sau |
