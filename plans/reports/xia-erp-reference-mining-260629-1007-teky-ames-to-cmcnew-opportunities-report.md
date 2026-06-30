# ERP Reference Mining — TEKY/AMES → CMCnew Opportunity Report

> **Mode:** `/ck:xia --compare` (research + analysis, no implementation)
> **Source:** `D:\project\ERP_Reference_Documentation` — 4-pass production audit of TEKY/AMES ERP (Odoo 11, 1.241 models, 67 companies, dual-brand, 8.583 employees)
> **Target:** CMCnew (greenfield ERP+LMS, TypeScript/tRPC/Prisma, Phase 0–4 built)
> **Date:** 2026-06-29 · **Branch:** develop
> **Confidence keys:** `[V]` verified against CMCnew schema/routers · `[I]` inferred · `[ref]` from reference docs

---

## 0. Verdict (TL;DR)

The user framed CMCnew as "khá sơ sài" (rudimentary). **That framing is too harsh.** Measured against this reference — a real production education ERP at large scale — CMCnew's foundation is **solid and, critically, it already avoids the reference system's worst design mistakes** (plaintext passwords, partner-inheritance bloat, no SSO, no audit trail).

What CMCnew lacks is **breadth of education-specific business logic** that the reference proves is high-value in production. The opportunity is **selective porting of validated business patterns**, NOT replicating 1.241 models.

Three things this report is careful about:
1. The reference is a **design reference, not code** — different stack (Odoo/Python vs tRPC/TS). Nothing is copy-pasteable; everything is *adapt*.
2. The reference includes **production usage data** (record counts). This lets us separate "features that mattered" (223K care tickets) from "features that were built but never used" (0 assignment records, 0 badge records). We mine the former and *avoid* the latter.
3. CMCnew is **single-brand (CMC), facility-scoped** — not dual-brand/67-company. So the reference's heavy multi-company machinery mostly **does not apply**; `facilityId` + RLS already fills that role.

**Top 5 highest-ROI additions** (detail in §4):
| # | Opportunity | Why it matters | Effort |
|---|---|---|---|
| P0-1 | **Milestone-driven care workflow** (auto care tasks at session 1/4/9/12) | 223K tickets in prod = the core retention engine; reference says "design from day 1, not add-on" | M |
| P0-2 | **Lead assignment log + owner row-scoping** | 3.3M records = most-used model; drives sales KPI fairness & "my leads only" | M |
| P0-3 | **E-invoice (hóa đơn điện tử)** | VN **legal compliance** for tuition; currently deferred to Phase 5 | M–L |
| P1-1 | **Structured channel attribution** (UTM/source/campaign) | Without it, marketing ROI (ctv_mkt role) is unmeasurable | S–M |
| P1-2 | **HR leave + employment contract** | VN labor compliance; part-time teacher reality | M |

---

## 1. What the reference is, and how to read it

- It is the distilled output of auditing the **TEKY (STEM) + AMES (English)** Odoo 11 production system through 4 passes, including a red-team correction pass. It is explicitly written *"để build ERP giáo dục tương tự — không phải để clone."*
- Its most valuable artifacts for us:
  - **Production record counts** (`02`, `04`, `05`) — tells us which workflows are load-bearing.
  - **Verified state machines** (`14 §4`) — admission, batch, enrollment, KPI, AI-engagement.
  - **The full student lifecycle** (`14 §5`) — acquisition → nurture → enrollment → learning → care → upsell → alumni.
  - **A pre-written "build a new project" guide** (`14`) and **gaps catalog** (`13`) — the reference authors already did half our gap analysis.
  - **Security lessons** (`13 §8`, `07`) — what to never repeat.

**Caveat on numbers:** record counts (e.g. 1.296.711 sessions) reflect a multi-year, multi-brand, 67-company operation. CMCnew at one company's scale will be 2–3 orders of magnitude smaller. Use the counts to rank *importance*, not to size *infrastructure*.

---

## 2. Validation — where CMCnew already matches best practice [V]

This is the reassuring half. CMCnew independently arrived at the reference's top recommendations:

| Reference lesson (`13`/`14`) | CMCnew state | Status |
|---|---|---|
| "Don't inherit res.partner for Student — 205 inherited fields = complexity" | `Student` is a standalone model; clean fields | ✅ Avoided |
| "Never store plaintext external passwords (classin/lms)" | `resetLmsPassword`, hashed secrets; passwords excluded from staff reads | ✅ Avoided |
| "Enable SSO from day 1 (TEKY had all OAuth disabled)" | Entra/MSAL SSO for staff; password is break-glass only | ✅ Done |
| "Separate person/employee identity from login account (8.583 emp vs 1.840 users)" | `EmploymentProfile` ⟂ `AppUser`; not every staff has login | ✅ Done |
| "KPI must link to contract → payslip from the start" | `domain-payroll` wires KpiScore → Payslip variable pay | ✅ Done |
| "Audit log — extend chatter beyond a few modules" | `RecordEvent` + `RecordFollower` (Odoo-style chatter), cross-domain | ✅ Done |
| "Every transactional model needs company_id isolation" | `facilityId` + Postgres RLS on every table | ✅ Equivalent |
| "Row ownership: 'my records only' for evals/sessions" | Partial — KPI separation-of-duties, owner-credit on create | 🟡 Partial (see P0-2) |
| "Effective-dated config (pricing/salary)" | `CoursePrice.effectiveFrom`, `SalaryRate.effectiveFrom`, `CompensationPolicy` | ✅ Done (exceeds ref) |

**Conclusion:** CMCnew is not "sơ sài" structurally. It is a lean, security-correct core. The gaps are **horizontal coverage**, not foundational flaws.

---

## 3. What CMCnew correctly did NOT copy (anti-patterns — keep avoiding) ⚠️

The reference's usage data is a gift: it tells us what to *not* build.

| Reference feature | Prod reality | CMCnew | Guidance |
|---|---|---|---|
| `op.assignment` (Assignments app) | **0 records** — built, never used | LMS uses `Exercise`/`Submission` instead | ✅ Don't add a parallel "assignment" concept |
| `op.badge.student` gamification | **0 records** — unused in prod | CMCnew **fully built** stars/badges/leaderboard/gifts | ⚠️ **Caution** — see Challenge Q3 |
| `sale.order` as enrollment hub | **17 records** — bypassed entirely | CMCnew enrolls via `Receipt`→`Enrollment` directly | ✅ Correct — don't introduce sale.order |
| `crm.lead` with 132 stored fields | bloated | CMCnew `Opportunity` is lean (~10 fields) | ✅ Keep lean (ref §04 lesson #1) |
| `hr.employee` with 143 stored fields | bloated (social-media + fingerprint fields) | CMCnew `EmploymentProfile` is minimal | ✅ Keep minimal |
| Raw Meta-Ads data in ERP DB (52-field insights) | heavy | CMCnew stores none | ✅ Keep attribution as *links*, not raw ad data (ref §14 §6.1) |

> **Headline anti-pattern:** the reference repeatedly warns against **over-customization** (1.241 models, 472 with no UI = dead/backend code, 192 wizards needing a dead-code audit). CMCnew's discipline (31 routers, single 1.355-line schema) is the right instinct. Every recommendation below is scoped to **preserve that leanness**.

---

## 4. Gap & Opportunity Catalog (prioritized)

Legend — **Effort:** S (≤2d) · M (3–8d) · L (>8d). **Lane** per `docs/FEATURE_INTAKE.md`.

### P0 — High business value, education-specific, validated by heavy prod usage

#### P0-1 · Milestone-driven Customer-Success care workflow `[V gap]`
- **Reference (`05`):** Care is auto-driven by **session milestones** — care tickets generated *before session 1*, then *after sessions 1, 4, 9, 11, 12*. Production: **223.687 tickets / 225.382 tasks**. The docs flag this as *"nghiệp vụ đặc thù và quan trọng nhất — thiết kế ngay từ đầu, không add-on sau."* Structure: `ticket` (the issue) → `task` (the work) → multi-dimensional assessment (satisfaction / progress / parent-interaction / upsell-potential).
- **CMCnew [V]:** `AfterSaleCase` is a **flat, manually-created** ticket (complaint/request/inquiry/refund). No milestone generator, no ticket→task split, no CS-side assessment. `grep milestone|carestage|upsell = 0`.
- **Why it matters:** This is the retention + early-churn-detection engine. Manual-only after-sales misses the "silent at-risk student" that scheduled milestone touches catch. CMCnew already has the raw signal needed — `ClassSession` ordinals per enrollment — to drive it.
- **Recommendation:** Add a **care-cadence generator** in `@cmc/domain-academic` (mirrors the existing parent-meeting cadence engine) that creates a `CareTask` at configured session ordinals. Extend `AfterSaleCase` with `milestone`, `careStage`, and a lightweight CS assessment block. Reuse the `StaffNotification` SSE channel for assignment.
- **Effort:** M · **Lane:** normal (touches after-sales + academic; bounded).

#### P0-2 · Lead assignment log + CRM row-ownership `[V gap]`
- **Reference (`04`):** `assign.log` = **3.337.441 records — the single most-used model in the system.** Tracks every (lead, assigned_to, assigned_by, date). Drives sales KPI. Plus ~59 `user.id` record rules implement **"my leads only"** read isolation; `crm.lead` is tied most-protected model (5 rules).
- **CMCnew [V]:** `Opportunity.ownerId` exists; on create, non-managers can only credit self (`crm.ts:23,138`). But there is **no assignment history** (reassignments, time-to-first-touch, round-robin audit) and **read scoping is by facility (RLS), not by owner** — so every sale at a facility likely sees every lead.
- **Why it matters:** (a) Sales KPI fairness & commission disputes need an immutable assignment trail; (b) "my leads only" prevents poaching and is a documented production pattern; (c) time-to-first-touch is a core sales-ops metric.
- **Recommendation:** Add an `OpportunityAssignment` append-only log (opportunityId, assignedToId, assignedById, reason, at). Decide explicitly whether CRM reads should be owner-scoped vs facility-scoped (**Challenge Q2** — this is a product call, not a pure tech one).
- **Effort:** M · **Lane:** normal→high-risk (touches authorization + audit — flag the row-scoping decision).

#### P0-3 · E-invoice (hóa đơn điện tử) `[V gap]`
- **Reference (`13 §4c`, `14 §11`):** MISA / sinvoice e-invoice is integrated and the docs call it **"MANDATORY từ ngày đầu (legal compliance)."** `account.invoice` = 43.028 records.
- **CMCnew [V]:** `Receipt` (PT-code) captures payment, but `grep invoice|einvoice = 0`. No legal e-invoice issuance. Deferred to Phase 5 per DEBT.
- **Why it matters:** In Vietnam, tuition revenue legally requires an electronic invoice. This is a **compliance risk**, not a feature nicety — it does not get cheaper by deferring, and finance/`ke_toan` will need it at go-live volume.
- **Recommendation:** Treat as a **config-driven integration** (provider: VNPT/MISA/Viettel SInvoice) emitting from approved `Receipt`. Build behind an integration-settings boundary (ref §10.1 rule #4) with an outbox pattern — CMCnew already has the `EmailOutbox` model to copy the durable-outbox shape from.
- **Effort:** M–L · **Lane:** high-risk (external provider + finance + legal). **Needs user decision on provider + timing.**

### P1 — High value, structural / compliance

#### P1-1 · Structured channel attribution (UTM / source / campaign) `[V gap]`
- **Reference (`04`,`14 §6`):** `crm.lead` carries `source_id`, `medium_id`, `campaign_id`, `fb_campaign_id`, `zalo_qr_scan`, `callio_ad_id` → enables `meta.report.roas` (ad-spend vs CRM revenue). Advice: store **links** to channel, not raw ad data.
- **CMCnew [V]:** `Contact.source` is a single free-text `String?` (`schema:1027`). No campaign/medium. `grep utm|campaign|medium = 0`.
- **Why it matters:** CMCnew has a `ctv_mkt` (marketing) role but **no way to attribute enrollments to channels** → marketing ROI is unmeasurable. Cheap to add now, expensive to backfill later.
- **Recommendation:** Add structured `source` / `medium` / `campaign` (+ optional `metaAdId`, `zaloQr`) to `Contact`/`Opportunity`. A simple enum+string is enough; no need for TEKY's 12-model Meta machinery.
- **Effort:** S–M · **Lane:** normal.

#### P1-2 · HR leave + employment contract `[V gap]`
- **Reference (`03`,`14 §3`):** `hr.contract` (date_start/end, wage, struct, **state: draft→open→close**) and `hr.leave`/`hr.leave.allocation` (**"cần implement từ ngày đầu cho compliance lao động VN"**), plus `hr.attendance`, `hr.expense`.
- **CMCnew [V]:** `grep contract|leave|overtime|expense = 0`. CMCnew has `SalaryRate` (effective-dated pay) and `Payslip`, but **no formal employment contract lifecycle** (probation→official→expired) and **no leave/timekeeping**. Attendance signal is sales-only (`CallMetric`).
- **Why it matters:** Payroll without leave/contract is incomplete for VN labor law; part-time teacher reality (the reference's 8.583-vs-1.840 insight) needs leave + reimbursement.
- **Recommendation:** Add a lean `EmploymentContract` (lifecycle state) and `LeaveRequest` (type, range, approval state draft→approved). Keep `hr.expense` optional (P2). Do **not** replicate TEKY's 102 hr.* models — core only.
- **Effort:** M · **Lane:** normal (HR), high-risk if it changes payroll computation.

#### P1-3 · Upsell loop: convert care-ticket → opportunity `[V gap]`
- **Reference (`05`):** CS identifies upsell during care → "Convert ticket to opp" wizard → new `crm.lead` → restart enrollment. This closes the retention→revenue loop.
- **CMCnew [V]:** No path from `AfterSaleCase` to `Opportunity`. `grep upsell|upsale = 0`. Renewal exists only as `ReceiptKind.renewal`, with no CRM-side upsell pipeline.
- **Recommendation:** Add a `crm.opportunityFromCase` procedure (pre-fills student/contact, tags source = `upsell`). Pairs naturally with P0-1 and P1-1.
- **Effort:** S · **Lane:** normal.

### P2 — Useful, lower urgency / cheap insurance

| ID | Opportunity | Reference | CMCnew [V] | Recommendation | Effort |
|---|---|---|---|---|---|
| P2-1 | **Waitlist** when class over capacity | GAP-006 | `grep waitlist=0`; `Enrollment.reserved` partially covers | Add `Waitlist` or formalize `reserved` + capacity-gate on enroll | S |
| P2-2 | **Alumni / post-completion lifecycle** | GAP-001/RT-010 ("confirmed gap, build from start") | `StudentLifecycle.completed` exists, no alumni relation/re-enrollment funnel | Add alumni view + re-enrollment opportunity trigger | S–M |
| P2-3 | **Vietnamese geography** (province/district/ward) | `14 §2` ("mandatory for VN, day 1") | `grep province/district=0`; address is free-text | Add a VN geo reference table + FK on Contact/Student; cheap now | S |
| P2-4 | **Structured lost-reason taxonomy** | `crm.lost.reason` + sub-reason | `Opportunity.lostReason` is free-text | Enum + optional sub-reason → funnel analytics | S |
| P2-5 | **CS multi-dimensional assessment** (satisfaction/progress/parent-interaction/upsell-potential) | `05` | `QualitativeAssessment` is academic-only | Add CS assessment fields to care ticket (feeds P1-3 scoring) | S |
| P2-6 | **High-volume table indexing** (session by date/batch, attendance by session) | `14 §9` | greenfield scale; not yet hot | Add indexes proactively (cheap; partitioning NOT needed yet) | S |
| P2-7 | **DB-backed integration-settings layer** | `14 §6.X` (config-driven, don't hardcode) | env-vars only (`GRAPH_*`,`CALLIO_*`) | Optional: move to per-facility settings table when multi-facility integrations diverge | M |

---

## 5. Decision Matrix (xia compare-mode)

| Decision | TEKY/AMES way | CMCnew way | Recommendation |
|---|---|---|---|
| Student identity | `_inherits` res.partner (205 inherited fields) | Standalone `Student` | **Keep CMCnew** |
| Multi-tenant isolation | `company_id` + 67 companies + 70 company rules | `facilityId` + Postgres RLS | **Keep CMCnew** (single-brand; RLS is cleaner) |
| Enrollment hub | `sale.activation.code` (sale.order bypassed) | `Receipt` → `Enrollment` | **Keep CMCnew** |
| Care workflow | Auto milestone ticket→task (223K rec) | Manual flat `AfterSaleCase` | **Adopt reference pattern** (P0-1) |
| Lead assignment | `assign.log` (3.3M rec) + owner row-rules | `ownerId` only, facility-read | **Adopt** assignment log; **decide** row-scoping (P0-2) |
| Channel attribution | structured UTM + 12 Meta models | free-text `source` | **Adopt structured links; reject raw-ad-data storage** (P1-1) |
| Gamification | built, **0 records** (unused) | fully built (stars/badges/leaderboard) | **Validate adoption** — see Q3 |
| E-invoice | MISA, mandatory | none (Phase 5) | **Pull forward as compliance** (P0-3) |
| HR breadth | 102 hr.* models | lean payroll core | **Add leave+contract only; reject the other ~95** |
| Integration creds | config params (167 keys) | env vars | **Keep env for now; table later if needed** |

---

## 6. Challenge Questions (xia Phase-4 gate)

1. **Is CMCnew single-brand permanently?** *Source:* dual-brand, 67 companies. *Local:* single CMC, facility-scoped. *Risk if wrong:* if CMC ever runs a second brand, `facilityId`-only isolation needs a `brandId`/tenant axis — cheap to anticipate, expensive to retrofit. **→ Confirm with user.**
2. **Should CRM reads be owner-scoped ("my leads only") or facility-scoped?** *Source:* ~59 user.id row-rules + assign.log. *Local:* facility RLS, role-gated. *Risk:* owner-scoping changes authorization semantics (high-risk lane) and affects manager dashboards. **→ Product decision (P0-2).**
3. **Will gamification actually be used?** *Source:* TEKY built it, got **0 records** — a documented failure-to-adopt. *Local:* CMCnew invested heavily in stars/badges/leaderboard/gifts. *Risk:* same dead weight. *Mitigant:* CMCnew's LMS is positioned as a **homework/practice platform** (per project memory), a different product than TEKY's classroom ERP — gamification may genuinely fit here. **→ Instrument adoption; don't expand further until usage data confirms.**
4. **Is e-invoice deferral a compliance exposure today?** *Source:* "mandatory day 1." *Local:* deferred Phase 5. *Risk:* tuition issued without legal e-invoice at production volume. **→ Confirm legal timing with finance/`ke_toan`.**
5. **Does payroll go live without leave/contract?** *Source:* leave needed "from day 1 for VN labor compliance." *Local:* payroll built, no leave/contract. *Risk:* payslips computed without leave deductions / contract basis = incorrect pay + labor-law gap for part-time teachers. **→ Scope P1-2 before payroll go-live.**
6. **Do we need assignment/attribution before or after first marketing spend?** *Risk:* every enrollment created before attribution exists is permanently unattributable. **→ If marketing spend is imminent, P1-1 jumps to P0.**

---

## 7. Suggested implementation slices (handoff to `/ck:cook`)

These are independent, vertically-sliced, and ordered by value/effort. Each maps to a `FEATURE_INTAKE` lane.

| Slice | Contents | Lane | Pre-req decision |
|---|---|---|---|
| **S1 — Care cadence** | P0-1 (milestone care generator + ticket→task + P2-5 assessment) | normal | none — reuses parent-meeting cadence pattern |
| **S2 — Sales ops** | P0-2 assignment log + P1-1 attribution + P1-3 upsell-from-case + P2-4 lost reasons | normal→high-risk | **Q2** (row-scoping), **Q6** (timing) |
| **S3 — HR compliance** | P1-2 leave + employment contract | normal/high-risk | **Q5** (payroll-go-live coupling) |
| **S4 — Finance compliance** | P0-3 e-invoice integration (outbox-backed) | high-risk | **Q4** (provider + legal timing) |
| **S5 — Lifecycle polish** | P2-1 waitlist, P2-2 alumni, P2-3 VN geography, P2-6 indexes | tiny/normal | none |

> Each slice should enter via `harness-cli intake`, get a story packet (or high-risk story folder for S2/S3/S4), and use `gitnexus_impact` before touching shared models (`Opportunity`, `AfterSaleCase`, `Payslip`, `Receipt`). None of these requires touching the reference repo again — it has been fully mined here.

---

## 8. Open questions for the user

1. **Single-brand forever, or anticipate multi-brand?** (drives whether to add a tenant axis above `facilityId` now — Q1)
2. **CRM read scope:** should a `sale` see *all* facility leads, or *only their own*? (Q2 — authorization change)
3. **Gamification:** keep/expand, freeze, or instrument-then-decide? (Q3)
4. **E-invoice:** which provider (VNPT / MISA / Viettel SInvoice), and is it needed before go-live? (Q4)
5. **Payroll go-live:** does it block on leave/contract (P1-2)? (Q5)
6. **Marketing spend timing** — is structured attribution (P1-1) urgent? (Q6)
7. **Scope appetite:** do you want me to proceed to a `/ck:cook` plan for **S1 (Care cadence)** — the highest-ROI, lowest-risk, no-decision-needed slice — or wait on the answers above?

---

---

# PHẦN II — Vòng phân tích bổ sung (2026-06-29, sau phản hồi user)

## II.0 Quyết định đã chốt

| # | Câu hỏi | Quyết định | Hệ quả |
|---|---|---|---|
| Q1 | Phạm vi đọc CRM | **`sale` thấy mọi lead của cơ sở** (giữ RLS theo facility) | Bỏ row-ownership "my leads only". **Vẫn giữ** assignment-log (P0-2) cho KPI/hoa hồng |
| Q2 | E-invoice | **Chưa triển khai thời điểm này** | Bỏ P0-3 khỏi phạm vi trước mắt. ⚠️ Vẫn là rủi ro pháp lý — quyết định lại trước khi thu học phí quy mô lớn |
| Q3 | Payroll vs leave/contract | **Payroll KHÔNG bị chặn** — go-live được, build leave sau ~4 tuần | Xem II.1 |
| Q4 | Gamification | **Giữ + tiếp tục triển khai** | Stars/badges/leaderboard/gifts là tính năng chính thức của LMS-homework |

## II.1 Quyết định Q3 — Payroll go-live (có nghiên cứu thực tế)

**Nghiên cứu (nguồn luật LĐ VN + thông lệ giáo dục):** trung tâm giáo dục VN nhiều GV part-time, thực tế nhập tay ngày công trước, formal-hoá leave sau là thông lệ chấp nhận được. Phép năm 12 ngày/năm (≥12 tháng), phép năm tính nguyên lương; thiếu dữ liệu ngày công → net sai.

**Soi schema CMC [V]:** `EmploymentProfile.grade` có bậc "PT3"; `CompensationPolicy` có "gói parttime" → part-time có thật. `Payslip` đã có `workdays` + `variablePay` + `variableNote` → nhập tay được ngay.

**Quyết định:** Payroll **không chặn** bởi leave/contract.
- Trước mắt: trừ phép không lương qua `variablePay`(âm)+`variableNote`; thêm **validation tổng ngày công ≤ chuẩn tháng** + quy ước reconciliation.
- Sau ~4 tuần: module Leave (đơn nghỉ / loại phép / số dư) + field `leaveWithoutPayDays` để tự tính.
- Lưu ý: `EmploymentProfile.userId` đang **unique + bắt buộc** → mọi nhân sự cần login. Nếu onboard nhiều GV thỉnh giảng → tách person ⟂ login (gap mới #7).

## II.2 Gap MỚI phát hiện từ `06–12, 15` (báo cáo vòng 1 chưa phủ)

Đã đọc đủ 16/16 file. Loại bỏ trùng với Phần I. Tất cả "CMC thiếu" đã đối chiếu inventory; các điểm ✶ đã xác minh trực tiếp schema.

### P1 — tài chính/vận hành cốt lõi
- **Trả góp học phí + nhắc nợ** (`account.notification`, cờ `SP_TRA_GOP`). CMC: `Receipt` thu trọn gói (`yearsPrepaid`✶), chưa có lịch trả góp + nhắc đến hạn. Tận dụng `EmailOutbox`/`StaffNotification`. **M**.
- **Ghi nhận doanh thu theo buổi (deferred revenue)** (`price.*`). CMC: ghi nhận **upfront**✶ → khó hoàn phí/bảo lưu công bằng theo số buổi còn lại. **L · high-risk (kế toán)**.
- **Buổi học bù (offset/makeup) + chuyển lớp/cơ sở** (`student.migrate`, admission `transferred`). CMC: `Enrollment/Attendance` chưa có offset/transfer. **M**.
- **Chia hoa hồng nhiều người/1 deal** (`affiliate_id/cosell_user_id/breakice`). CMC: `Opportunity` 1 owner, không cosell✶ → liên quan trực tiếp payroll. **M**.
- **Zalo ZNS + cổng duyệt gửi** (`zns.campaign`: approver→scheduled→sent). CMC: chỉ `EmailOutbox`. Zalo chạm phụ huynh VN tốt hơn email. **M (mở rộng adapter+approval lên outbox sẵn có)**.

### P2 — mở rộng / pattern kỹ thuật
- **Idempotency cho worker** (lock-token + context-fingerprint + msg-hash dedup, học từ `ai.agent.engagement`). Áp ngay cho `EmailOutbox`/`ParentMeeting` node-cron để chống gửi trùng khi worker chạy lại. **S–M — đáng làm sớm**.
- **Tách person/employee ⟂ login** (8.583 emp vs 1.840 user ở TEKY). CMC `EmploymentProfile.userId` unique+bắt buộc✶. **S (chủ yếu quyết định mô hình)**.
- **Lịch ca làm việc nhân sự** (`hr.work.schedule.*`) — `ScheduleSlot` chỉ là lịch lớp. Tính lương theo giờ công chuẩn. **M**.
- **Phụ cấp năng lực theo bậc** (`kpi.capability.allowance.monthly`) — tách khỏi hoa hồng KPI. **M**.
- **Cảnh báo doanh thu chủ động** (`kpi.revenue.warning`) — rule-engine ngưỡng, dùng kênh `StaffNotification`. **S–M**.
- **Onboarding/orientation nhân viên** (`hr.applicant.onboarding`, `orientation.*`). **M**.
- **DMS tài liệu nội bộ tối giản** (`muk_dms`: cây thư mục + ACL group + S3) — lưu HĐ/CV/hồ sơ có kiểm soát. Làm nhẹ, đừng copy 11 model. **M**.
- **Hardening bảo mật:** password-history cho tài khoản local (parent/guardian/student), enforce 2FA cho ke_toan/hr/giám đốc, mã hoá-at-rest secret/PII. CMC đã hơn TEKY (có SSO) nhưng còn thiếu các lớp này. **S–M**.
- **Membership/VIP tier HV** (`member_rank`,`membership_stop`). **S**.
- **Survey theo giai đoạn lead** (Formbricks breakice/meeting). **S**.

### Chỉ THAM KHẢO — không copy
- MCP/OAuth2 API layer (`muk_mcp`, 0 key dùng) — CMC là tRPC monolith → YAGNI; chỉ học ý tưởng "API key có policy whitelist + audit + expiration".
- Kho activation-code (`sale.activation.*`) — gốc của anti-pattern sale.order bypass; chỉ học mô hình "mã kích hoạt enrollment".
- 4Rent / Library-lending / Asset-maintenance / Helpdesk — low value cho LMS-homework.
- Multi-company-per-center (67 res.company) — **không copy**; RLS theo facility của CMC sạch hơn.

## II.3 Roadmap cập nhật (slice cho `/ck:cook`)

| Slice | Nội dung | Lane | Phụ thuộc |
|---|---|---|---|
| **S1 — Care cadence** | P0-1 chăm sóc theo mốc buổi + ticket→task + CS assessment | normal | không — sẵn sàng cook |
| **S2 — Sales ops** | P0-2 assignment-log + P1-1 attribution + chia hoa hồng đa-bên (mới #4) + upsell-from-case + lost-reason | normal→high-risk | — (Q1 đã chốt: không cần row-scoping) |
| **S3 — Finance theo buổi** | trả góp (mới #1) + deferred revenue (mới #2) + offset/transfer (mới #3) | high-risk (kế toán) | quyết định mô hình ghi nhận doanh thu |
| **S4 — HR compliance** | leave + employment contract + tách person⟂login (mới #7) | normal/high-risk | sau payroll go-live (Q3) |
| **S5 — Hạ tầng/worker** | idempotency worker (mới) + index bảng lớn + password-history/2FA | tiny/normal | — đáng làm sớm, rủi ro thấp |
| **S6 — Lifecycle** | waitlist + alumni + VN geography + membership tier | tiny/normal | — |
| ~~e-invoice~~ | hoãn (Q2) | — | — |

---

### Appendix — Source coverage
Đã đọc đủ **16/16** file tham chiếu. Vòng 1 (controller, đọc sâu): `README, 01, 02, 03, 04, 05, 13, 14`. Vòng 2 (subagent, bóc tách bổ sung): `06_integrations, 07_security, 08_infrastructure, 09_erd, 10_model-catalog (lướt), 11_menu, 12_field-details, 15_methodology` + `quality-review-report.html` (meta-audit tài liệu, không có gap nghiệp vụ mới). CMCnew: Prisma schema (`packages/db/prisma/schema.prisma`, 1.355 lines), 31 tRPC routers, RBAC registry — gap kiểm chứng bằng grep trực tiếp (✶ = đã xác minh schema). Nghiên cứu Q3: luật LĐ VN + thông lệ payroll giáo dục (nguồn web trong báo cáo agent).
</content>
</invoke>
