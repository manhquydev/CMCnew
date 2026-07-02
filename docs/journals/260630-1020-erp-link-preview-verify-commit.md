---
title: "Verify + Commit ERP Link-Preview Metadata"
date: 2026-06-30
scope: verify-and-commit
intake: 38
lane: normal
commit: 3ea6490
story: ../stories/ERP-LINK-PREVIEW.md
---

# Verify + Commit ERP Link-Preview Metadata

## Context

ERP-LINK-PREVIEW feature was implemented but uncommitted in the working tree. Task: verify it under Harness, then commit. Feature adds module-aware title/description/OG/Twitter metadata to the admin ERP app, both at runtime (on navigation) and at build time (per-route static HTML), plus an nginx rule for the CRM opportunity route.

## What Happened

- Recorded intake #38 (normal lane).
- Verified ground truth: typecheck PASS, lint PASS, test 8/8 PASS, build PASS (22 module HTML files generated with correct per-module titles incl. `/crm/opportunities`).
- Ran `gitnexus detect_changes`: medium risk, limited to `App.tsx` Dashboard navigation — matches expectation.
- Spawned `code-reviewer`: verdict COMMIT WITH NOTES, no Critical/High.
- Committed via `git-manager`: `3ea6490` on `develop`, secret scan PASS, no unrelated files staged, no push (remote paused).
- Logged follow-up backlog #12 (unit tests) and #13 (og:url asymmetry + nginx ordering).

## Reflection

The story's Evidence claimed "8/8 unit tests PASS" as proof for this feature, but those tests are the pre-existing `nav-consistency.test.ts` suite — they do not exercise `link-preview-metadata.ts`. The riskiest code (the regex meta-replacer and the metadata fallback) has zero dedicated coverage. Verification ran the real commands rather than trusting the story, caught the mismatch, and the story wording was corrected before recording the trace so the durable record does not claim coverage that does not exist.

## Decisions

- Commit now; defer og:url parity, nginx regex reordering, and a dedicated unit test as backlog follow-ups (low risk, KISS).
- Corrected story Evidence/Validation wording to state no dedicated unit test exists; build + HTML inspection is the primary proof.

## Next

- Backlog #12: add unit tests for `getAdminMetadata` + `renderHtmlForMetadata`.
- Backlog #13: resolve og:url runtime/static asymmetry and nginx asset-regex ordering.
