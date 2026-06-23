# DEBT - deliberate gate-skips (a loan, written down)

- [ ] DEBT: MinIO content-addressed object store (spec §3) deferred; S1.7 uses local-disk content-addressed PDF store behind the storage driver -- Dev-only: exercise PDFs live on the API host's local data dir, not a durable/replicated object store; serve endpoint auth is coarse (any valid session) -- close before: Before production go-live: swap driver to MinIO/S3, add per-principal access check on the file serve endpoint, move bucket creds to secrets -- opened 2026-06-23
