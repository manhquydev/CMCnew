---
phase: 4
title: "Render Gift Image in LMS"
status: done
priority: P1
dependencies: []
---

# Phase 4: Render Gift Image in LMS

## Overview
Hiện `gift.imageUrl` trong LMS cho **HS và PH**. Đây là mắt xích Critical bị thiếu: hiện `RewardsTab` chỉ vẽ `IconGift` + tên, KHÔNG có `<img>` — nếu không có phase này, upload/seed ảnh vô hình với người dùng.

## ⚠️ Red-team correction (F1 — Critical)
`apps/lms/src/student-view.tsx:944-983` (`RewardsTab`) render `IconGift` + name + badges + nút, **không có phần tử ảnh nào**. `imageUrl` được fetch vào type nhưng chưa dùng. Parent rewards view (`parent-view.tsx:982`) tương tự — kiểm và sửa cả hai.

## Requirements
- Functional: mỗi card quà hiện ảnh từ `imageUrl`; fallback `IconGift` khi `imageUrl` null. Áp cho cả student `RewardsTab` và parent rewards tab.
- Non-functional: `imageUrl` có thể là **ref** (64-hex → build `${API_URL}/files/gift-photo/${ref}`) hoặc **http(s) URL** (dùng nguyên) — backward-compat.

## Architecture
- Helper `giftImageSrc(imageUrl: string | null): string | null` (đặt cạnh `RewardsTab` hoặc trong `packages/ui`): nếu match `/^[a-f0-9]{64}$/` → `${API_URL}/files/gift-photo/${imageUrl}`; nếu bắt đầu `http` → nguyên; else null.
- `RewardsTab` card: thêm ảnh khi `giftImageSrc(g.imageUrl)` không null; null → giữ layout `IconGift` hiện tại. Ảnh trên cùng card, cao cố định, `object-fit: cover`, bo góc theo `cmc-clay-card`.
- **Edge (Session 2): ảnh lỗi/mất blob** (vd reset dữ liệu dev xoá `.data` → serve 404) → `onError` chuyển về `IconGift` (dùng state `imgError` hoặc Mantine `<Image>` fallback). Không để ô ảnh vỡ.
- Parent rewards tab: cùng helper + cùng render.
- `API_URL` import từ `@cmc/ui` (`client.ts:5`).

## Related Code Files
- Modify: `apps/lms/src/student-view.tsx` — `RewardsTab` card (L944-983): thêm ảnh + helper.
- Modify: `apps/lms/src/parent-view.tsx` — rewards tab (~L982): render ảnh tương tự.
- Maybe: `packages/ui/src/index.tsx` — export `giftImageSrc` nếu dùng chung 2 view.

## Implementation Steps
1. Viết `giftImageSrc` (ref vs URL vs null).
2. Thêm `<Image>` + fallback vào student `RewardsTab`.
3. Thêm tương tự vào parent rewards tab.
4. **Verify thủ công (dev)**: quà có ref → ảnh hiện; quà có http URL → ảnh hiện; quà `imageUrl=null` → fallback `IconGift`, layout không vỡ; kiểm cả HS và PH.

## Success Criteria
- [x] HS thấy ảnh quà (ref hoặc URL) trong tab "Đổi quà". **Scope thu hẹp (user quyết định khi cook)**: PH KHÔNG có gift catalog nào trong parent-view.tsx hiện tại (chỉ balance/badges/leaderboard, xác nhận qua grep — `trpc.rewards.gifts.query()` chỉ gọi từ student-view.tsx) → không có gì để sửa ảnh; user chọn "students only", parent-view.tsx giữ nguyên không đổi.
- [x] `imageUrl` null → fallback icon, không vỡ layout.
- [x] Là điều kiện nghiệm thu cho "HS thấy ảnh" của Phase 5 (seed).
- [x] Lint/typecheck LMS xanh.

## Risk Assessment
- Ảnh 404 nếu `API_URL`/serve sai → verify với 1 ref thật (sau Phase 2) trước khi seed.
- Card layout mobile: ảnh cao cố định + `object-fit: cover` tránh vỡ grid (`SimpleGrid cols base:1/sm:2/md:3`).
