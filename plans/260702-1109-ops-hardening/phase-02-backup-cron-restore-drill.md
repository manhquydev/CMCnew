# Phase 2 — Backup cron install + dedupe + restore drill

## Context links
- Report §"PLAN 7" item 2: `plans/reports/brainstorm-260702-1109-fullproject-completeness-p4-p7-report.md:44`
- Runbook §5: `docs/prod-deploy-security-runbook.md:74-75` (references `scripts/backup-db.sh`, says "cron daily" + "test restore" but neither is installed)
- Canonical script: `scripts/backup-db.sh` (docker exec, plain SQL `--clean --if-exists`, retention prune)
- Duplicate to delete: `scripts/db-backup.sh` (host `pg_dump -Fc` custom format)
- Restore: `scripts/db-restore.sh` (uses `pg_restore` — pairs with the DELETED custom-format script, NOT with backup-db.sh)

## Overview
`backup-db.sh` exists and the runbook claims daily backup, but no cron is installed anywhere in the deploy path and
no restore has ever been drilled. Three scripts overlap with an incompatible-format trap. This phase: dedupe to one
backup + one matching restore, install the cron on the VPS (operator-assisted), and run one restore drill with
recorded evidence.

## Key Insights
- **Format mismatch is a data-integrity landmine.** `backup-db.sh` emits **plain SQL** (`pg_dump --clean --if-exists`
  piped to gzip) restored via `psql`. `db-restore.sh` calls `pg_restore` which ONLY reads custom/`-Fc` archives — it
  will error on a plain-SQL gzip. Deleting `db-backup.sh` (the only `-Fc` producer) leaves `db-restore.sh` unable to
  restore anything the surviving backup produces. **Realigning restore to the plain-SQL path is mandatory, not cosmetic.**
- Prod postgres exposes no host port (runbook note) → both backup and restore must go through `docker exec`, not host
  `psql -h`. Rewrite `db-restore.sh` to the docker-exec `psql` path used in `backup-db.sh:31-32`'s own restore comment.
- Cron belongs on the VPS host crontab (or a compose sidecar). Agent cannot reach the VPS → cron install + drill are
  **operator-assisted**; the plan provides exact commands + an evidence template the operator fills in.

## Requirements
- One backup script (`backup-db.sh`), one restore script (`db-restore.sh`) with **matching plain-SQL format**.
- `db-backup.sh` deleted; any doc/reference repointed to `backup-db.sh`.
- Cron entry installed on the VPS: daily `backup-db.sh` with logging + retention (already `RETENTION_DAYS=14`).
- One restore drill executed against a throwaway DB/container (NEVER prod), evidence recorded.
- Runbook §5 expanded from 2 lines to actual install + drill procedure.

## Architecture
```
VPS host crontab
  0 2 * * *  ENV_FILE=/secrets/.env.production /root/cmcnew/scripts/backup-db.sh >> /var/log/cmc-backup.log 2>&1
        │
        ▼ docker exec cmcnew-prod-postgres-1 pg_dump --clean --if-exists | gzip
   ./backups/cmc-<stamp>.sql.gz   ──(drill)──► gunzip | docker exec -i postgres psql -d <drill_db>
```

## Related code files
- MODIFY `scripts/backup-db.sh` — confirm docker-exec path, ensure ENV_FILE/BACKUP_DIR documented for cron use
- DELETE `scripts/db-backup.sh` — remove the `-Fc` duplicate
- REWRITE `scripts/db-restore.sh` — plain-SQL restore via `gunzip -c file | docker exec -i <pg> psql -U $DB_USER -d $DB_NAME`; keep the 5s abort guard + `cmc_app` password reminder; drop the drop/create-DB-as-superuser assumptions that don't hold via docker exec
- MODIFY `docs/prod-deploy-security-runbook.md` §5 — cron install steps + restore-drill procedure + evidence pointer
- CREATE `docs/ops/restore-drill-YYMMDD.md` — evidence template (operator fills: date, backup file, drill DB, row-count checks, outcome)

## Implementation Steps
1. Delete `db-backup.sh`; grep repo for `db-backup.sh` references and repoint to `backup-db.sh`.
2. Rewrite `db-restore.sh` to the plain-SQL docker-exec path; make the target DB a parameter so a drill can restore
   into a scratch DB name (e.g. `cmc_drill`) without touching `cmc`.
3. Expand runbook §5: (a) host crontab line, (b) `/var/log` rotation note, (c) restore-drill steps into a scratch DB,
   (d) mark every VPS command **[operator-assisted]**.
4. Add `docs/ops/restore-drill-YYMMDD.md` template.
5. **[operator-assisted]** on VPS: install crontab entry; run `backup-db.sh` once; restore latest dump into `cmc_drill`;
   verify a known table row count; record results in the drill doc.

## Todo list
- [ ] Delete db-backup.sh + repoint references
- [ ] Rewrite db-restore.sh to plain-SQL docker-exec, parameterized target DB
- [ ] Expand runbook §5 (cron + drill, operator-assisted tags)
- [ ] Add restore-drill evidence template
- [ ] [operator] install cron, run backup, run drill, record evidence

## Success Criteria
- Only `backup-db.sh` + `db-restore.sh` remain; they use the same (plain SQL) format — a fresh backup restores cleanly.
- Runbook §5 contains copy-pasteable cron + drill commands, all VPS steps tagged operator-assisted.
- `docs/ops/restore-drill-*.md` filled with a real drill: backup file name, scratch DB, row-count parity, pass/fail.

## Risk Assessment
- **Format mismatch left unfixed (HIGH×HIGH):** restore silently fails when needed most. Mitigation: step 2 is the
  gating deliverable; add a note in the drill doc that pass = actual restore into scratch DB, not "script ran".
- **Drill hits prod DB (LOW×CRITICAL):** parameterize target DB + hardcode scratch name in the drill doc; restore
  script keeps the 5s abort + refuses if target == `cmc` unless `--force`.
- **Cron env not loaded (MED×MED):** cron has a bare environment; the crontab line must pass `ENV_FILE` explicitly (script already sources it at `backup-db.sh:13`).

## Security Considerations
- Backups contain full PII (students, payroll) → `./backups` must be non-web-served, root-only perms; document in §5.
- Never commit a dump or `.env.production`. Drill evidence doc records file names/sizes only, never contents.

## Next steps
- Feeds go-live criterion "backup chạy tự động + restore đã diễn tập". Consider off-box backup copy (rsync/object store) as a later debt item — out of scope here (YAGNI).
