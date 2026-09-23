# INFRASTRUCTURE AUDIT (CI/CD, envs, deploy, DR pointers)

## CI/CD (.github/workflows/ci.yml + nightly.yml)

- PR gates: lint → typecheck → test, then e2e + build (needs[] correct).
  Nightly adds coverage + build + 30-day artifacts. Reproducible: Node 20
  pinned, npm ci, lockfile v3 consistent with package.json (1.0.0).
- Gaps: e2e needs secrets/browsers (may be red on forks — acceptable);
  no coverage thresholds; no load-test job; branch protection + required
  checks live in GitHub settings — UNVERIFIABLE from repo (INFRA-001, P2).
- Vercel: cron declared (cleanup 02:00); env scoping preview-vs-prod
  unverifiable (INFRA-001); deployment rollback = redeploy previous build
  (docs/ROLLBACK.md) — procedure sound, drill unevidenced (DEP/PV-CRON open).

## Environment & secrets management

- `.env.example` complete; `.env.local`/data/test-results/.next correctly
  ignored and untracked (verified via git ls-files). No secrets in tree or
  sampled history (shapes only; full gitleaks run recommended pre-close).
- Runtime secret handling is correct (server-only reads, redacted logs,
  fail-closed absence). Prod secret strength/rotation unevidenced —
  owner-session item (PV-OBS env audit).
- Local PAT hygiene issue: SEC-003 (P2).

## Disaster recovery (detail in DISASTER_RECOVERY_AUDIT.md)

- Backups/PITR: prescribed but unevidenced → OPS-001 (P2). R2 versioning/
  object-lock unevidenced. Secret recovery undocumented. Restore never
  drilled → DR-001 folded into OPS-001/roadmap Phase 1.

## Findings: INFRA-001 (P2), OPS-001 (P2), SEC-003 (P2), DEP-001 (P3),
INFRA-002 nightly coverage thresholds (P3, in FINDINGS via QUAL? — filed
under documentation/CI note in REMEDIATION_ROADMAP Phase 2).
