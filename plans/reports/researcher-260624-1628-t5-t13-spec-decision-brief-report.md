# Decision Brief: T5 (win-back classification) & T13 (auto-cadence parent meetings)

**Prepared:** 2026-06-24 | **Status:** ✅ specs read, code audited, drift surfaced | **For:** Flow controller → project owner

---

## ITEM T5: Receipt `kind` Classification for Win-Back Scenario

### What Spec Intends

**Source:** `docs/specs/payroll-v2-commission-design.md` §"Quy tắc mới vs tái tục" (line 25–28).

> **MỚI** ⇔ receipt gắn Opportunity đã tới O5_ENROLLED **VÀ** là receipt approved đầu tiên của HS trong chương trình đó.
> **TÁI TỤC** ⇔ HS đã có receipt approved trước đó (cùng chương trình), không qua opp test mới.
> **Ca quay lại sau gián đoạn** (HS hết khóa, nghỉ, quay lại qua test mới): có receipt cũ → suy "tái tục", nhưng đi qua phễu mới → có thể muốn "mới (win-back)".
>
> **Quyết định chính sách của chủ dự án** (xem Q2 [line 46]).

**Decided policy (line 46):**
> **Quay lại sau gián đoạn = KHÁCH MỚI (win-back)** nếu đi qua phễu test đầu vào mới (có Opportunity + TestAppointment entrance mới). Không cần ngưỡng thời gian.

**→ Win-back counts as NEW when:**
1. Student has prior receipt (lapsed enrollment).
2. **Student re-enters via O5_ENROLLED opportunity** (phễu mới, not just re-collecting under old opp).
3. Test appointment is fresh (implicit in "phễu test đầu vào mới").

### What Code Does Today

**Source:** `apps/api/src/routers/finance.ts` line 235–245 (receiptApprove).

```typescript
const kind = opp?.stage === 'O5_ENROLLED' ? 'new' : priorCollected > 0 ? 'renewal' : 'new';
```

**Logic:**
- If linked receipt → O5_ENROLLED opp → `kind = 'new'`.
- Else if student has prior collected receipt → `kind = 'renewal'`.
- Else → `kind = 'new'`.

**Equivalence:**
- ✅ **If opp at O5_ENROLLED** → treated as NEW (covers first-time AND win-back via phễu).
- ❌ **If opp NOT at O5_ENROLLED** → defaults to RENEWAL/NEW based on prior history **only**, ignoring opp reachability.

### The Drift

**Case: Student with lapsed receipt, re-entering WITHOUT opportunity link.**

| Scenario | Spec Intent | Code Result | Match? |
|---|---|---|---|
| Opp @ O5_ENROLLED (phễu mới) | NEW (win-back) | NEW ✅ | ✅ **MATCH** |
| No opp, prior receipt exists | ??? (ambiguous) | RENEWAL ❓ | ⚠️  **Ambiguous** |
| No opp, no prior receipt | NEW (first-time) | NEW ✅ | ✅ **MATCH** |

**Exact ambiguity:**
The spec says "đi qua phễu test đầu vào mới" (must signal via O5_ENROLLED opp in the funnel). But the code falls back to "priorCollected > 0" **regardless of opp state**. So:

1. **Win-back via LINKED O5 opp** → ✅ correctly NEW.
2. **Win-back via NO opp, direct receipt creation** → ❌ incorrectly RENEWAL (violates intent to count as NEW).

**The question:** Is manual receipt creation without opp link **expected to happen** in production? If yes, the code misclassifies. If no, the code is safe (but silent assumption).

### Concrete Options & Trade-offs

**Option A: Code matches spec as-is (assume opp always linked for win-back).**
- **Trade-off:** Works IF all win-back enrollments go through O5_ENROLLED opp. Staff must never create receipt without opp for returning students.
- **Risk:** Silent misclassification if UI allows opp-free receipt creation → payroll undercount.
- **Effort:** None (code as-is).

**Option B: Require opp for win-back intent; validate at receiptCreate.**
- **Trade-off:** Staff MUST link opp to receipt, even if opp was created ad-hoc post-test (lax on timing).
- **Pro:** Forces explicit win-back signal (opp), preventing silent misclass.
- **Effort:** Add validation in `receiptCreate` to warn/block if student has prior receipt but opp is missing.

**Option C: Auto-detect win-back from TestAppointment (no opp required).**
- **Trade-off:** If student has prior receipt + a fresh TestAppointment ≥ N days ago → infer win-back = NEW.
- **Pro:** Survives opp-less receipts; less staff coordination needed.
- **Con:** Adds timestamp inference logic; still silent if threshold is wrong.
- **Effort:** Medium (add TestAppointment lookup in receiptApprove).

---

## ITEM T13: Auto-Cadence Parent Meetings

### What Spec Intends

**Source:** `docs/specs/parent-meeting.md` (entire) + `docs/project-charter.md` line 63.

**Charter cadence rule (line 63):**
> **Họp phụ huynh:** UCREA mỗi 5 tháng; Bright I.G & Black Hole mỗi 3 tháng; **auto-gen idempotent**.

**Spec design (lines 6–9):**
- Meetings are **per-class (ClassBatch)**, not per-student.
- **Auto-generated on cadence** (no manual creation); staff do NOT create meetings manually.
- **Idempotent via `remindedAt`** on the meeting record (prevents duplicate reminders).
- **Reminders** (T-1 day) are cron-based (node-cron embedded, every 30 min tick).

### What Code Does Today

**Source:** `apps/api/src/routers/parent-meeting.ts` + `apps/api/src/services/parent-meeting-reminder.ts`.

**PM2 implementation (commits 605c576, 9f5284f, 4be4bf3):**
- ✅ Schema: `ParentMeeting` table with `remindedAt` idempotency flag.
- ✅ Router: `create`, `list`, `setStatus` (staff manual CRUD).
- ✅ Reminders: `runParentMeetingReminders` cron tick (embedded node-cron).
- ✅ RLS: staff-facility + parent-via-enrollment.

**⚠️ MISSING:**
- **Auto-cadence generation** — no job creates `ParentMeeting` rows on schedule.
- **No config for cadence intervals** — hardcoded "5 months" and "3 months" nowhere in the code.
- **No anchor date or class-start mapping** — unclear when cadence "clock" starts.

**Current behavior:** Staff manually create meetings via `create` mutation; system only manages **reminders** (T-1 day tick), not **generation**.

### The Drift

**Spec says:** "auto-gen idempotent" → system GENERATES meetings per class per cadence.
**Code does:** Staff manually create meetings; system only reminds.

**Unresolved detail questions:**

| Question | Spec says | Code says |
|---|---|---|
| **Who creates meetings?** | System (auto-gen on cadence) | Staff (manual via UI) |
| **What triggers creation?** | Program cadence (5mo UCREA, 3mo BI/BH) | Staff action |
| **What's the anchor date?** | Not specified; implied = class start? | No code; not applicable |
| **Config location** | Inferred per-program | Not implemented |
| **Idempotency scope** | Per-class per-period (no duplicates) | `remindedAt` flag (prevents duplicate reminders, not duplicate meetings) |

### Concrete Options & Trade-offs

**Option A: Keep manual creation; codify as design change.**
- **Pro:** Staff have control; no automation risk.
- **Con:** **Violates spec intent** ("auto-gen idempotent"). Meetings may be missed or duplicate if staff forget.
- **Effort:** Update spec to reflect staff-driven model (breaking change to charter).
- **Recommendation:** ❌ Not acceptable without explicit approval to change scope.

**Option B: Implement auto-cadence (spec-compliant).**
- **Architecture:**
  1. Add `ParentMeetingPolicy` config: per-facility, per-program, `cadenceMonths` + anchor date + time-of-day.
  2. Add cron job: daily tick on class-based logic:
     - For each active ClassBatch: compute next-due meeting date from `policy.cadenceMonths + last_meeting.scheduledAt` (or class.startedAt if none exist).
     - If next-due ≤ today + X days → create idempotent `ParentMeeting` (upsert on `(classBatchId, dueDate)` to avoid duplicates).
     - Existing manual `create` can coexist (staff can still override/add).
  3. Existing reminder tick (T-1) unchanged.
- **Pro:** Spec-compliant. Meetings auto-scheduled; staff reminder-driven only.
- **Con:** Adds complexity; requires config UI.
- **Effort:** Medium (config entity + cron job + idempotency logic).

**Option C: Hybrid — auto-cadence + optional manual override.**
- **Architecture:** As Option B, but allow staff `create` to add ad-hoc meetings (not conflict with cadence).
- **Pro:** Safety valve; spec-compliant + staff flexibility.
- **Con:** More code paths; potential confusion if staff create overlapping meetings.
- **Effort:** Medium-high (requires clear UX separation: "auto" vs "manual").

---

## Questions to Resolve (Owner Decision)

### T5 Win-Back Classification

**Cần chốt:**

1. **Is manual receipt creation WITHOUT opp link expected for win-back students?**  
   - If **YES** → current code misclassifies (Option B or C needed).
   - If **NO** (opp always linked) → code is safe; document assumption.

2. **For win-back via no-opp receipt:** Should we infer win-back from TestAppointment timing, or require explicit opp?**  
   - Explicit opp (Option B): Safer, staff controls signal.
   - Infer from test (Option C): More resilient, but adds complexity.

3. **What is the time threshold (if any) for "lapsed"?** Spec says "không cần ngưỡng thời gian" but no prior-receipt age check is coded.  
   - Any prior collected receipt → always renewal (unless O5 opp).
   - Or: only receipts within last N months count as "lapsed" (older = new).

### T13 Auto-Cadence Parent Meetings

**Cần chốt:**

1. **Confirm scope: Is "auto-gen" mandatory for v1, or deferred?**  
   - Charter says "auto-gen idempotent" → binding.
   - If deferred → update charter + roadmap to mark T13 as "Reminders only, cadence staff-driven (v2)".

2. **If auto-gen required:** What anchors the cadence start?**  
   - Class start date (`classBatch.startedAt`)?
   - Facility calendar (e.g., academic year start)?
   - First manual meeting date (if auto-gen happens after some manual creates)?

3. **What's the target time-of-day for auto-generated meetings?**  
   - Fixed (e.g., 3pm ICT)?
   - Configurable per-facility?

4. **Should auto-cadence meetings be removable/editable, or read-only for compliance?**  
   - Editable (staff can reschedule if conflict) → more flexible, harder to reconcile with cadence.
   - Read-only created, can only setStatus→cancelled → enforces cadence intent, stricter.

5. **Does the 35% cap on discount apply to win-back, or only new students?**  
   - (Unrelated to T13, but appears in T5 code context — clarify if in scope.)

---

## Next Steps

1. **Owner provides answers** to the 5 "Cần chốt" questions above.
2. **Controller updates backlog item acceptance criteria** with owner's decisions.
3. **Implement** per selected options (A/B/C for each item).
4. **Sync spec/code** to reflect any policy changes.

---

## Summary: Sharpest Questions for Owner

1. **T5 Q1:** Does staff ever create receipts for returning students WITHOUT linking an opp? (If yes → code bug.)
2. **T5 Q3:** Do lapsed students need a time threshold (e.g., no receipt in 6+ months = win-back), or any prior receipt = potential renewal?
3. **T13 Q1:** Is "auto-gen idempotent" binding for v1, or is "staff-manual only" acceptable with charter amendment?
4. **T13 Q2:** If auto-gen required, what date anchors the cadence (class start, facility calendar, or rolling from now)?
5. **T13 Q4:** Should auto-cadence meetings be locked (read-only after create, only setStatus allowed), or editable?
