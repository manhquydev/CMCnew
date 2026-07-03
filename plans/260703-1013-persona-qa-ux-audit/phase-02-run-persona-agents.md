---
phase: 2
title: "Run Persona Agents"
status: pending
effort: ""
---

# Phase 2: Run Persona Agents

## Overview

Run 6 independent agents in parallel, each given ONLY its role name + login credentials + a
short "what would this person realistically try to do" task list — no codebase/architecture
context, no hints about known bugs. Each drives a real browser (chrome-devtools or playwright
MCP) against the live prod URL for its app, attempts its tasks end-to-end, and reports friction.

## Requirements

- Each agent prompt MUST NOT mention: this session's known bugs (checkin IP leak, EmploymentProfile
  crash, shift-config placeholder data), internal file names, or any codebase detail. The point is
  a genuinely blind first-time-user experience.
- Each agent gets: role name, login URL + credentials, 3-5 realistic tasks for that role, and an
  instruction to report EVERY point of confusion/friction/error — not just crashes.

## Persona Task Lists (draft — refine per role's actual permission scope before running)

| Persona | App | Sample tasks |
|---|---|---|
| Sale (tư vấn tuyển sinh) | erp.cmcvn.edu.vn | Log in, find CRM/leads, create a test lead `[QA-TEST]`, try to convert it to an opportunity |
| Giáo viên | erp.cmcvn.edu.vn | Log in, find today's schedule, check in for a session, try attendance marking, look for exercises |
| Giám đốc kinh doanh | erp.cmcvn.edu.vn | Log in, find revenue report, find CRM overview, try executive cockpit if visible |
| Giám đốc đào tạo | erp.cmcvn.edu.vn | Log in, find attendance report (new Phase-2 feature), try creating a makeup session, review a class |
| Học sinh | hoc.cmcvn.edu.vn | Log in via OTP, find homework/exercises, try submitting one, check grades |
| Phụ huynh | hoc.cmcvn.edu.vn | Log in via OTP, find child's progress, check attendance, look for meeting schedule |

## Implementation Steps

1. Spawn all 6 as parallel Agent tool calls (single message, multiple tool_use blocks) —
   independent, no shared state, each self-contained with its own credentials.
2. Each agent uses chrome-devtools or playwright MCP tools to actually navigate/click/type — not
   just read code. Screenshot on any confusing/broken screen.
3. Each agent returns a structured report: role, tasks attempted, tasks completed vs blocked,
   findings list (each tagged technical/UI/UX + severity: blocker/major/minor).
4. Collect all 6 reports for Phase 3.

## Success Criteria

- [ ] All 6 personas complete their login step (proves Phase 1's account setup actually works).
- [ ] Each persona attempts all its assigned tasks (partial completion + a clear blocker reason is
      an acceptable, informative outcome — not a failure of this phase).
- [ ] Each report is genuinely blind (no evidence the agent was fed prior codebase knowledge).
