---
phase: 1
title: "Setup Test Accounts"
status: pending
effort: ""
---

# Phase 1: Setup Test Accounts

## Overview

Create 6 dedicated `[QA-TEST]`-tagged accounts (one per persona) on live prod: 4 staff (sale,
giáo viên, giám đốc kinh doanh, giám đốc đào tạo) via temporary password-login, 2 non-staff
(học sinh, phụ huynh) via existing OTP/passwordless flows — no policy change needed for those 2.

## Implementation Steps

1. On the VPS, set `STAFF_PASSWORD_LOGIN=true` in `/root/cmcnew/.env.production`, restart the
   `api` container (`docker compose -f docker/docker-compose.prod.tls.yml --env-file
   /root/cmcnew/.env.production restart api` or equivalent) to pick it up.
2. As `super_admin` (existing `admin@cmcvn.edu.vn` account), use the real admin UI staff-creation
   flow to create 4 accounts:
   - `qa-test-sale@cmcvn.edu.vn` — role `sale`
   - `qa-test-giaovien@cmcvn.edu.vn` — role `giao_vien`
   - `qa-test-gdkd@cmcvn.edu.vn` — role `giam_doc_kinh_doanh`
   - `qa-test-gddt@cmcvn.edu.vn` — role `giam_doc_dao_tao`
   Set a throwaway password for each (record for the persona agents, not in any committed file).
3. Create 1 test student + 1 test parent via the real admin UI student-creation / guardian-link
   flow (not direct DB seeding — the point is exercising the real onboarding path a blind persona
   would hit). Name both with a `[QA-TEST]` prefix (e.g. `[QA-TEST] Nguyễn Văn A`).
4. Verify each of the 6 accounts can actually log in (staff via password, student/parent via LMS
   OTP flow) before handing off to Phase 2 — a broken login blocks that persona's entire run.

## Success Criteria

- [ ] 4 staff QA-TEST accounts created, each logs in successfully with password auth.
- [ ] 1 student + 1 parent QA-TEST account created via real onboarding UI (not DB seed), parent
      can complete OTP login.
- [ ] `STAFF_PASSWORD_LOGIN=true` confirmed active on prod (verify via a successful QA-TEST login,
      not just the env var being set — the app must actually pick it up).
- [ ] Credentials recorded somewhere NOT committed to git (e.g. this session's working memory /
      a local scratch file) for Phase 2's agents to use.
