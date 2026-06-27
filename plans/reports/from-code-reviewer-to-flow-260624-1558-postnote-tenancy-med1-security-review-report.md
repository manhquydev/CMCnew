# MED-1 postNote Tenancy Fix — Security Review

Scope: apps/api/src/routers/audit.ts, packages/audit/src/index.ts, packages/ui/src/chatter.tsx, 3 teaching call sites, record_event/receipt/opportunity/class_batch RLS.
Posture: report-only, no edits.

## Verdict
SAFE-TO-CLOSE. The MED-1 cross-facility + NULL-facility audit poisoning vector is fully closed. One pre-existing, lower-severity follower-table concern noted (out of MED-1 scope).

## Findings (severity-ranked)

### CRITICAL / HIGH — none

### MED — none introduced by this fix

### LOW-1 (pre-existing, not a regression): `audit.follow` writes record_follower without visibility gate
audit.ts:64-71. The standalone `follow` mutation passes raw client `entityType`/`entityId` to `addFollower`. `record_follower` has RLS deliberately disabled (migration 20260623071949 line 263, "non-sensitive metadata"). So any staff can insert a follower row for an arbitrary entity. Impact is bounded: the row carries no facility_id and never lands in the `record_event` timeline, so it is not the MED-1 data-poisoning vector and leaks no cross-facility content. `postNote`'s own `addFollower` call (audit.ts:59) is now safely gated behind the entity-visibility check. Optional hardening: route `follow` through the same NOTE_TARGETS resolve, or accept as low-value metadata. Not blocking.

## Assessment against the 5 questions

1. Cross-facility + NULL poisoning fully closed? YES. Client facilityId is dropped from the input schema (audit.ts:34-41); facilityId is server-resolved from the target entity via RLS (audit.ts:48,52). Unsupported entityType → BAD_REQUEST before any DB touch (audit.ts:45-46). Invisible entity → NOT_FOUND (audit.ts:49-50). The `facility_id IS NULL` RLS escape can no longer be reached from postNote because logEvent always receives a concrete `entity.facilityId` (NOT NULL on all three tables).

2. Is RLS-scoped findUnique sound — could a visible row belong to another facility? NO bypass. All three targets have `facility_id INTEGER NOT NULL`:
   - class_batch USING: `app_is_super_admin() OR facility_id = ANY(app_facility_ids())` (20260623071949:272).
   - receipt USING: `app_is_super_admin() OR (app_principal_kind()='staff' AND facility_id = ANY(app_facility_ids()))` (20260623170152:138).
   - opportunity USING: same staff-gated form (20260623175123:62).
   None has a `facility_id IS NULL` branch, so a row visible to a staff caller provably has facility_id ∈ caller's facility set. `rlsContextOf` leaves principalKind unset → withRls defaults to 'staff' (packages/db/src/index.ts:43), satisfying the `app_principal_kind()='staff'` predicate. Resolution is sound.

3. record_follower tenancy risk? Pre-existing, low (see LOW-1). No facility column, not on the audit timeline, RLS intentionally off. Not a MED-1 vector.

4. Chatter UI entityType missing from NOTE_TARGETS? NO gap. Grep of apps/teaching/src shows exactly 3 live `<Chatter>` surfaces: opportunity (crm-panel.tsx:388), class_batch (App.tsx:725), receipt (finance-panel.tsx:320) — all three are in NOTE_TARGETS. chatter.tsx is the only client postNote caller. No other entityType reaches postNote, so nothing legitimate breaks.

5. Test quality — mutation-proof, no false-pass? YES.
   - Uses a real RLS-scoped staff caller (`isSuperAdmin:false, facilityIds:[B]`), not super-admin, so RLS genuinely applies.
   - Test 1: B-staff noting batch A → NOT_FOUND, then asserts `notesOn(batchA)` (read under SUPER, bypassing RLS) has length 0. Old code inserted a NULL-facility row that SUPER read would see → old code fails this assertion. Genuinely kills the old behavior.
   - Test 2: B-staff notes own batch B → asserts stored `facilityId === B` (never NULL). Old code defaulted to client NULL → would fail.
   - Test 3: `app_user` entityType → BAD_REQUEST before any write.
   Note: case-sensitivity is implicitly covered — entityType is matched exactly against NOTE_TARGETS keys, so e.g. `Receipt`/`RECEIPT` fall through to BAD_REQUEST (no silent global note). No false-pass risk identified.

## Edge cases checked
- entityType case variants → unsupported → BAD_REQUEST (safe).
- Entity attacker CAN see but shouldn't note: by construction, RLS visibility == same facility for these three tables, so "visible but cross-facility" is impossible here.
- Other logEvent callers (crm/finance/payroll/etc.) derive facilityId server-side from freshly created/loaded entities, not client input — outside MED-1 scope, no regression.
- withRls GUCs are transaction-local (set_config ...,true) on a dedicated interactive-tx connection — no cross-request leak.

## Unresolved questions
- Product call: should `audit.follow` (LOW-1) be gated through the same NOTE_TARGETS resolve, or is follower metadata acceptably non-sensitive? Recommend tracking as a separate low-priority item, not blocking MED-1 closure.

Status: DONE
