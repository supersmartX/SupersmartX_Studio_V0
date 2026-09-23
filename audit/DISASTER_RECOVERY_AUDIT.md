# DISASTER RECOVERY AUDIT

## Current state (mostly absent — the point of this file)

| Pillar | Evidence in repo | Status |
| ------ | ---------------- | ------ |
| DB backup | none (Turso PITR prescribed in docs/DATABASE.md, not evidenced) | OPS-001 (P2) |
| DB restore drill | none recorded | open — roadmap Phase 1 |
| RPO / RTO | undefined | open — must be declared pre-close |
| R2 recovery | no versioning/object-lock config evidenced | open — verify console |
| Deployment rollback | redeploy-previous procedure documented | PARTIAL — drill open (PV-CRON/DEP-001 adjacent) |
| Secret recovery | undocumented (rotation runbook missing) | open — write with SEC-003 rotation |
| Account recovery | password-reset flow sound; admin recovery path undocumented | P3 — document |
| Single points of failure | single Turso DB, single R2 bucket, single Vercel project, one human with PAT (SEC-003) | open — access + ownership transfer plan |

## Minimum pre-acquisition bar (roadmap Phase 1)

1. Enable + screenshot Turso PITR retention; declare RPO/RTO in docs.
2. Restore drill to staging branch; record row-count evidence in audit/.
3. Confirm R2 versioning/lifecycle posture; document object-restore path.
4. Write secret-rotation runbook (doubles as SEC-003 remediation).
5. Enumerate production access holders; plan ownership transfer.

No code changes required — this is console + process work with audit
artifacts. Until then, acquirer must price an undefined-RPO data story.
