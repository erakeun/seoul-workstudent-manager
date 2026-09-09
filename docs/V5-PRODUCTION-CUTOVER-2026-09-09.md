# V5 Production cutover — 2026-09-09

This is the non-secret production evidence for the V5 cutover. Backup contents,
passwords, session tokens, and private Drive file identifiers are not committed.

## Gate evidence

- Final raw Script Properties backup was created in the owner-only backup folder,
  read back, checksummed, and confirmed not to change `swtm2`.
- The candidate spreadsheet was prepared with 16 protected system tabs, including
  `budgetAudit`, `settings`, and `metadata`.
- Source and target counts matched: 9 students, 14 accounts (4 admin, 0 viewer,
  10 student), 1 semester, 35 schedules, 2 attendance rows, 1 substitution, and
  1 handover note. All other operational tables contained zero rows.
- Relationship validation passed, migration checksum matched, missing/duplicate
  records were zero, and `REVIEW_REQUIRED` attendance rows were zero.
- Live Sheets read latency was 773 ms. A write/read/restore round-trip passed;
  the changed value was observed and the original checksum was restored (275 ms
  write, 165 ms restore).
- The prior live two-writer Apps Script rehearsal retained both writes under the
  ScriptLock and restored the candidate checksum afterward.
- Both existing attendance rows were unchanged after migration.
- Apps Script KST/UTC boundary checks passed for KST midnight and year rollover.
- All 101 legacy sessions were parseable and rejected by the V5 auth-version
  boundary without deleting session data.
- Automated tests passed 86/86; browser and Apps Script syntax checks passed.

## Cutover

- `swtm_ledger_v5` was set to the verified spreadsheet only after the final
  backup and every gate above passed.
- `swtm2` remains unchanged and read-only as the rollback source; it was not
  deleted or initialized.
- The existing Web App deployment ID and `/exec` URL were retained. Apps Script
  version 9 serves protocol version 5 and returned `ready: true` after cutover.
- Non-destructive live login and session smoke requests returned the expected
  credential/session errors, proving both routes reach the V5 Sheets-backed API.

The earlier rehearsal report remains historical evidence of the pre-cutover
state. This document is authoritative for the completed Production Gate.
