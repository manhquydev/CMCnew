# Gift Photo Store: Disk Driver in Production (Supersedes S3 Plan)

Date: 2026-07-16

## Status

Accepted

## Context

Plan `plans/260716-0856-lms-schedule-rewards-exercises/plan.md` (Phase 2 authoring, Session 1
validation) locked the decision that gift-photo storage in production would use S3/MinIO,
explicitly mirroring `pdf-store.ts`'s prod configuration and removing any disk/bind-mount
fallback from scope ("bỏ mọi tham chiếu photo-store disk|s3").

During Phase 5 implementation, that premise was checked against the actual deployed
configuration and found to be stale: `docker/docker-compose.prod.tls.yml` — the file whose own
header comment calls it "the authoritative file for the live VPS" — has **zero** `S3_*` /
`PDF_STORE_DRIVER` / MinIO wiring for any blob store today. Only its sibling
`docker-compose.prod.yml` ("local prod-like runs", not the real deploy target) offers that
option. So "mirror pdf-store's prod S3 setup" pointed at something that isn't actually live.

Wiring `GIFT_PHOTO_STORE_DRIVER=s3` into the real prod file without also adding a MinIO service
and bucket-init step there (neither exists in that file for any store) would mean flipping the
driver later fails silently — no S3 target configured.

## Decision

Gift-photo storage in production uses the **disk driver with a host bind-mount**, matching how
every other blob store (`pdf-store.ts`, `photo-store.ts`) actually runs in the live
`docker-compose.prod.tls.yml` today — not S3/MinIO as originally planned.

- `docker-compose.prod.tls.yml`: added a `gift-photos` bind-mount volume, matching the existing
  `pdf`/`session-photos` pattern. No S3 env wiring added (none exists there for any store).
- `docker-compose.prod.yml` (the non-authoritative "local prod-like" file, which already offers
  PDF's S3 option): added `GIFT_PHOTO_STORE_DRIVER`/`GIFT_PHOTO_STORE_DIR` env passthrough
  mirroring its existing PDF pattern, for parity — this file is not what's actually deployed.
- `scripts/ensure-blob-store-dirs.sh` and `scripts/backup-db.sh` updated to create/chown/back up
  the gift-photos directory alongside the existing pdf/session-photos ones.
- `apps/api/src/services/gift-photo-store.ts` (Phase 2) already supports both `disk` and `s3`
  drivers via `GIFT_PHOTO_STORE_DRIVER` — this decision only changes which one prod actually uses
  today; flipping to S3 later remains possible once MinIO is genuinely wired into the
  authoritative prod file (out of scope here — that gap pre-exists for every other store too).

This decision was confirmed directly with the user (options presented: mirror actual prod
reality with disk+bind-mount / add real S3+MinIO wiring to the authoritative prod file / defer
the decision — user chose disk+bind-mount).

## Alternatives Considered

1. Wire `GIFT_PHOTO_STORE_DRIVER=s3` + MinIO + bucket-init into `docker-compose.prod.tls.yml`
   for real.
   - Pro: matches the original plan; would also fix the same latent gap for pdf-store/
     session-photos as a side effect.
   - Con: larger, shared-infra change beyond this feature's scope; not requested.
2. Disk + bind-mount, matching actual current prod reality (Accepted).
   - Pro: simplest, no new infra, consistent with how every other blob store already runs in the
     real deployed file.
   - Con: revises the plan's original "S3" decision — this doc exists to make that revision
     explicit and traceable.

## Consequences

- `plans/260716-0856-lms-schedule-rewards-exercises/plan.md` and
  `phase-02-gift-photo-store-endpoints.md` still contain the original "S3 locked" text from
  authoring/validation — that text is superseded by this decision, not edited in place (decision
  docs are the durable record; the plan's own history stays intact).
- If MinIO/S3 is ever wired into `docker-compose.prod.tls.yml` for other stores, gift-photo can
  flip to `s3` by setting `GIFT_PHOTO_STORE_DRIVER=s3` — no code change needed, the driver seam
  already exists.

## Follow-Up

- Update `docs/DECISION_INDEX.md` to point `docker-compose.prod.tls.yml`,
  `docker-compose.prod.yml`, `apps/api/src/services/gift-photo-store.ts`, and the two ops scripts
  at this decision for the gift-photo-specific driver choice.
