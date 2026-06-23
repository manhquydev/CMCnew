# DEBT - deliberate gate-skips (a loan, written down)

- [ ] DEBT: MinIO content-addressed object store (spec §3) deferred; S1.7 uses local-disk content-addressed PDF store behind the storage driver -- Dev-only: exercise PDFs live on the API host's local data dir, not a durable/replicated object store -- close before: Before production go-live: swap driver to MinIO/S3, move bucket creds to secrets -- opened 2026-06-23
  - PARTIALLY PAID 2026-06-23: per-principal access check on the file serve endpoint is DONE — `/files/exercise/:ref` now authorizes via the exercise RLS policy (staff→facility, parent/student→enrolled class) before serving; verified live (staff 200, owner-parent 200, foreign-parent 403, anonymous 401). Remaining: durable object store + secrets.

- [ ] DEBT: Receipt render is print-to-PDF HTML, not a server-generated PDF -- `/files/receipt/:id` returns styled Vietnamese HTML (browser Ctrl+P → Save as PDF); a true server PDF (pdf-lib) needs an embedded Unicode font for Vietnamese diacritics -- close before: if a non-interactive/archival PDF artifact is required, embed a TTF via @pdf-lib/fontkit -- opened 2026-06-24
