# Flow Verify — Rewards / CSKH / LMS (student+parent)

Date: 2026-06-27 | API: http://localhost:4000 | Facility 1
Actors: super_admin (admin@cmc.local), LMS student TEST-001 (id `6ea842a9-…d60c54`), parent parent@cmc.local
Method: tRPC-over-curl (raw JSON). Test data written via API; no source modified.

## Step → Result

### Flow 1 — Rewards (PASS, full cycle)
| Step | Proc | Result |
| --- | --- | --- |
| Inspect star balance | rewards.balance (student) | OK — 5 stars |
| List gifts | rewards.gifts | OK — empty initially |
| Create gift | rewards.giftCreate (staff) | OK — "Bút chì test", stars 5, stock 3 |
| Student redeem | rewards.redeem (student) | OK — reward `e2c4…`, status pending; **balance 5→0 (ledger debit verified)** |
| Staff approve | rewards.review approved | OK — status approved; balance stays 0 (no refund) |
| Re-redeem | rewards.redeem | OK — balance 5→0 |
| Staff reject | rewards.review rejected | OK — **balance 0→5 refunded** (stock restored) |
| Star earn + badge | grade.grade + grade.publish | OK — `starsEarned:5, badgesAwarded:1`; balance →5; badge "Sao Vàng 5" auto-awarded (source=auto) |

Badge unlock criteria verified: created badge `stars_total >= 5`; on grade publish the net star aggregate hit 5 → `studentBadge` auto-created, idempotent. (Auto-unlock lives in `grade.ts publish`, not in rewards.)

### Flow 2 — CSKH / aftersale (PARTIAL — note step fails)
| Step | Proc | Result |
| --- | --- | --- |
| Create case (linked to student) | afterSale.create | OK — case `2ea2…`, status open, priority high |
| Assign to staff | afterSale.assign (cskh user) | OK — assignedToId set |
| **Add note** | audit.postNote (after_sale_case) | **FAIL — BAD_REQUEST "Không hỗ trợ ghi chú cho 'after_sale_case'"** |
| Change status | afterSale.transition → in_progress → resolved | OK — resolvedAt stamped |

### Flow 3 — LMS student submit (PASS)
| Step | Proc | Result |
| --- | --- | --- |
| List published exercises | exercise.listForPrincipal | OK — RLS-scoped to enrolled class |
| Create+publish fresh exercise | exercise.create / publish (staff) | OK |
| Save draft | submission.save (student) | OK — status draft |
| Submit | submission.submit (student) | OK — status submitted |
| Appears for grading | submission.listByExercise (staff) | OK — visible with student name/code |

(Re-submit guard confirmed working earlier: pre-existing graded submission could not be re-submitted.)

### Flow 4 — LMS parent (PARTIAL — OTP login blocked; password fallback PASS)
| Step | Proc | Result |
| --- | --- | --- |
| OTP request | lmsAuth.otpRequest | Returns `{ok:true}` only — **no devCode** (Graph configured ⇒ suppressed). OTP row created but email send failed (see log). |
| OTP verify | lmsAuth.otpVerify | **Could not complete** — code is hashed/unrecoverable in this env |
| Password login (fallback) | lmsAuth.loginParent | OK — parent session, linked to child |
| List children / progress | submission.forStudent | OK — sees child graded submissions |
| Child badges | badge.myBadges | OK — "Sao Vàng 5" visible to parent |
| Parent meetings | parentMeeting.myMeetings | OK (empty) |
| Cadence generate | parentMeeting.runCadence | OK — `classesScanned:0, meetingsCreated:0` (no eligible seed classes) |

### Flow 5 — Server log scan
One error present:
```
OTP email send failed Error: Graph sendMail HTTP 404: {"error":{"code":"ErrorInvalidUser","message":"The requested user 'Thongbao@cmcvn.edu.vn' is invalid."}}
    at sendViaGraph (apps/api/src/lib/graph-client.ts:151:11)
```
Startup also: `email outbox: 0 sent, 1 failed, 0 rescheduled`. No Prisma/500/unhandled errors during the flows.

## FINDINGS

- **BUG 1 (Medium) — CSKH cases have no chatter/notes.** `after_sale_case` is missing from `NOTE_TARGETS` in `apps/api/src/routers/audit.ts` (only receipt, opportunity, class_batch, student supported). So `audit.postNote` and `audit.timeline` reject after-sale cases. The documented CSKH "add note" capability is unavailable. Fix: add an `after_sale_case` resolver to `NOTE_TARGETS`.
- **BUG 2 (Medium, config) — Graph email send broken.** `GRAPH_SENDER_NOTIFY` mailbox `Thongbao@cmcvn.edu.vn` is invalid in the M365 tenant (Graph 404 `ErrorInvalidUser`). All notify-channel emails fail, including parent login OTP. Because env makes Graph "configured", `requestLoginOtp` suppresses `devCode`, so parent OTP login is effectively unusable in this environment — only `loginParent` (password) works. Fix the sender mailbox (valid licensed user/shared mailbox) or correct the env value.
- **Note (not a bug):** parent-meeting cadence produced 0 meetings — no classes match the cadence rule in seed data, not a defect. Endpoint behaves correctly.

## Unresolved questions
- Is parent OTP intended as the primary parent login (password is a legacy fallback per code comments)? If yes, BUG 2 is release-blocking for parents.
- Should `setStudentLifecycle` / case-driven lifecycle changes surface on a CSKH timeline once BUG 1 is fixed?
