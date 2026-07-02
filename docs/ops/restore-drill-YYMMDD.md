# Restore drill — YYYY-MM-DD

Template. Copy to `docs/ops/restore-drill-<YYMMDD>.md` (drill date) and fill in every field before
the drill is considered "done". Never run against the live `cmc` database — target is always a
scratch DB (`cmc_drill`).

## Inputs
- Backup DB file: `backups/cmc-<stamp>.sql.gz`
- Backup blob archive: `backups/cmc-blobs-<stamp>.tar.gz`
- Scratch target DB: `cmc_drill`
- Scratch blob dirs: `PDF_STORE_DIR=`, `SESSION_PHOTO_STORE_DIR=`
- Operator: 
- Date/time run: 

## DB restore
- Command run: `./scripts/db-restore.sh <sql.gz> <blobs.tar.gz> cmc_drill`
- Row-count parity check (table + expected vs actual):
  - `Student`: expected ____ / actual ____
  - `Receipt`: expected ____ / actual ____
- Outcome: PASS / FAIL — notes:

## Blob restore
- Extracted file count: ____
- Spot-opened one PDF: PASS / FAIL — file ref: ____
- Spot-opened one session photo: PASS / FAIL — file ref: ____
- Outcome: PASS / FAIL — notes:

## Cleanup
- [ ] `DROP DATABASE cmc_drill;` run
- [ ] Scratch blob dirs removed

## Overall result
PASS / FAIL — summary:
