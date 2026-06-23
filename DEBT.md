# DEBT - deliberate gate-skips (a loan, written down)

- [ ] DEBT: MinIO content-addressed object store (spec §3) deferred; S1.7 uses local-disk content-addressed PDF store behind the storage driver -- Dev-only: exercise PDFs live on the API host's local data dir, not a durable/replicated object store -- close before: Before production go-live: swap driver to MinIO/S3, move bucket creds to secrets -- opened 2026-06-23
  - PARTIALLY PAID 2026-06-23: per-principal access check on the file serve endpoint is DONE — `/files/exercise/:ref` now authorizes via the exercise RLS policy (staff→facility, parent/student→enrolled class) before serving; verified live (staff 200, owner-parent 200, foreign-parent 403, anonymous 401). Remaining: durable object store + secrets.

- [ ] DEBT: Receipt render is print-to-PDF HTML, not a server-generated PDF -- `/files/receipt/:id` returns styled Vietnamese HTML (browser Ctrl+P → Save as PDF); a true server PDF (pdf-lib) needs an embedded Unicode font for Vietnamese diacritics -- close before: if a non-interactive/archival PDF artifact is required, embed a TTF via @pdf-lib/fontkit -- opened 2026-06-24

- [x] ACCEPTED (security-class, approved by operator 2026-06-24): identity tables `parent_account` / `student_account` opened from super_admin-only to any-staff read/write at the RLS layer (parents/students still excluded). Facilities are linked branches, not silos — these are system-wide identities (docs/specs/facility-model-decision.md). Residual exposure: any staff DB query can read parent/student contact rows; mitigated by (a) router role-gate (guardian mgmt = bgd/quan_ly/super only) and (b) every select excludes passwordHash/login secrets. Verified live: quan_ly (non-super) reads cross-facility parents; giao_vien → FORBIDDEN.

- [x] DROPPED 2026-06-24 (operator decision): Chat CSKH (AI chatbot via Gemini) removed from roadmap — never built; the `cskh` role + Odoo-style `chatter` activity log stay (unrelated). No code to remove.
