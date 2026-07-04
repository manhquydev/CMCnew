---
phase: 2
title: Frontend detail panel
status: completed
priority: P1
dependencies:
  - 1
effort: M
---

# Phase 2: Frontend detail panel

## Overview

Sửa `shift-reg-detail-panel.tsx`: cho sửa ngày khi draft (A2), fix bỏ chọn ca chọn-1 (A3), NewRegForm mặc định/min ngày mai (A2).

## Requirements

- Functional: draft → sửa `Từ ngày/Đến ngày` (min = ngày mai) lưu qua `updateDates`, reload lưới theo range mới; click ca lần 2 bỏ chọn ở cả 2 chế độ; NewRegForm default + minDate = ngày mai.
- Non-functional: giữ auto-save `toggle()` + guard `busy` + rollback; báo lỗi bằng `notifyError`.

## Architecture

**A3 — bỏ chọn ca (root cause + fix tối giản):** ô chọn-1-ca dùng `<Radio>` (dòng ~273) — radio HTML **không bắn `onChange` khi đã checked** → không bỏ được. `toggle()` (dòng 93-122) đã hỗ trợ bỏ chọn sẵn. Fix tối giản, đúng nguồn gốc: **đổi `<Radio>` → `<Checkbox radius="xl">` giữ nguyên `onChange={() => isDraft && toggle(...)}`** — vì Mantine Checkbox CÓ bắn `onChange` khi bỏ tích (khác Radio) nên chỉ cần thay component là bỏ chọn được, giữ hình tròn cho gợi ý "chọn 1". **KHÔNG dùng `onClick`** (Checkbox bắn cả onClick lẫn onChange → double-toggle). Chế độ nhiều-ca giữ nguyên `<Checkbox>`. Vẫn `disabled={!isDraft}`.

**A2 — sửa ngày draft:** thêm 2 `DateInput` (Từ/Đến) vào header khi `isDraft`, `minDate = ngày mai` (dayjs().add(1,'day')). Khi đổi → gọi mutation mới `trpc.shiftRegistration.updateDates.mutate({id, fromDate, toDate})`; thành công → cập nhật `reg` + reload entries (range đổi ⇒ `dates` tính lại; entries ngoài range đã bị backend dọn). Lỗi → `notifyError` + giữ giá trị cũ.

**A2 — NewRegForm:** đổi default `today` → `dayjs().add(1,'day')`; `fromDate` mặc định ngày mai, `toDate` mặc định +1 tháng; `DateInput minDate = ngày mai`; giữ disable nút khi `from>to`.

## Related Code Files

- Modify: `apps/admin/src/shift-reg-detail-panel.tsx`

## Implementation Steps

1. A3: đổi `<Radio .../>` (nhánh `selectionMode==='SINGLE'`) → `<Checkbox radius="xl" checked=... onChange={() => isDraft && toggle(date,t.id)} disabled={!isDraft}/>`; kiểm cả 2 chế độ bỏ chọn được.
2. A2 detail: thêm handler `handleUpdateDates(from,to)` gọi `updateDates`; render 2 `DateInput` khi `isDraft` ở Card header (thay text tĩnh Từ/Đến ngày); `minDate` = ngày mai; reload sau khi lưu.
3. A2 NewRegForm: đổi default + `minDate` sang ngày mai.
4. Kiểm khi range co lại: lưới render đúng, không lỗi entries mồ côi (backend đã dọn).

## Success Criteria

- [ ] Chế độ 1-ca: click lần 2 bỏ chọn; chế độ nhiều-ca vẫn bỏ chọn được.
- [ ] Draft: sửa được Từ/Đến ngày, không chọn được ngày ≤ hôm nay; range mới áp dụng cho lưới.
- [ ] NewRegForm mặc định ngày mai, không tạo được với ngày ≤ hôm nay.
- [ ] Phiếu không phải draft: ngày + ô ca vẫn read-only.

## Risk Assessment

- Đổi Radio → Checkbox-as-radio: đảm bảo vẫn 1-ca/ngày (backend `updateEntry` đã chặn >1 khi SINGLE — UI chỉ cần đại diện đúng).
- `minDate` client chỉ là UX; nguồn chân lý là validate backend (Phase 1) — không được bỏ.
- Reload sau updateDates: tránh double-fetch; tái dùng `loadReg()`.
