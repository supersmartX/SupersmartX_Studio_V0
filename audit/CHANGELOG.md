# Acceptance Changelog

## 2026-09-22 — Final certification preparation (no refactor)

- Health endpoint exposes non-sensitive deploy identifier: `commit` =
  first 7 of `VERCEL_GIT_COMMIT_SHA` (or `unknown`); no secrets, no
  infra detail (`src/app/api/health/route.ts`). Smallest possible change
  per program §5.
- Added `src/__tests__/health.test.ts` (4 tests): commit field present /
  fallback clean / anon `checks` hidden / auth-only `checks` without
  secrets. Suite now 410/410 PASS; tsc, lint (0 errors), build re-verified.
- Created `audit/OWNER_PRODUCTION_CERTIFICATION_RUNBOOK.md`: executable
  owner session (Tests 0–9) mapping 1:1 to the 9 certification blockers,
  with evidence standard, secrets policy, and certification-closing rule.
- No changes to auth, payments, storage, DB architecture, or business logic.

## 2026-09-22 — Production Acceptance Program

### Fixed

1. **P1 — SQLite FK enforcement enabled** (`src/lib/db/index.ts`):
   `ensureMigrated()` now runs `PRAGMA foreign_keys = ON` on every call.
   Previously `ON DELETE CASCADE` in the schema was unenforced (SQLite
   defaults OFF per connection), so deletes could orphan rows and FK
   violations were silently possible.
2. **P1 — Missing referential actions added via migration v10**
   (`src/lib/db/schema.ts`, `SCHEMA_VERSION` 9→10): rebuilt `exports`
   (`job_id … REFERENCES export_jobs(id) ON DELETE SET NULL` — completed
   exports survive nightly job cleanup) and `user_stats`
   (`FOREIGN KEY … ON DELETE CASCADE`). Copy filters historical orphans
   (unreachable rows dropped, dangling `job_id` nulled) so the migration
   cannot fail on legacy data. This fix was *discovered by* the new
   regression test: enabling the pragma made `DELETE FROM users` fail on
   the old schema, proving the gap was live.
3. **P2 — `PATCH /api/export-jobs/[id]` key validation**
   (`src/app/api/export-jobs/[id]/route.ts`): client-supplied
   `resultR2Key` must start with `exports/{userId}/` (400 otherwise);
   `resultExportId` type/length-checked. Authoritative key binding remains
   in `/api/exports/complete`.
4. **Critical — Next.js 16.3.0 → 16.3.6** (`package.json`/`package-lock.json`
   via `npm audit fix`): resolves critical RCE advisories
   (GHSA-p293-qw3h-jr36, GHSA-2xp9-vwfh-vxw4) + transitive sharp high.
   Prod `npm audit --omit=dev`: 0 vulnerabilities.
5. **Debt**: removed 3 dead unused imports/consts in presigned-put/complete
   routes (lint warnings 28→25, still 0 errors).

### Tests added (17; suite 389→406, all green)

- `src/__tests__/db-constraints.test.ts` (5): pragma ON, FK rejection of
  orphan child rows, user-delete cascade, cross-user ownership scoping,
  job-cleanup SET NULL semantics.
- `src/__tests__/server-authoritative.test.ts` (12): forged-plan fallback,
  expired/missing-expiry fails closed, 1080p clamp for free, platform lock,
  duration ceilings, concurrent quota increments capped, storage-cap
  rejection, monthly consume/revert.

### Docs added

- `docs/`: ARCHITECTURE, LOCAL_DEVELOPMENT, ENVIRONMENT, DATABASE,
  AUTHENTICATION, AUTHORIZATION, ENTITLEMENTS, EXPORT_PIPELINE, STORAGE,
  DEPLOYMENT, ROLLBACK, INCIDENT_RESPONSE, TROUBLESHOOTING.
- `audit/`: BASELINE, ACCEPTANCE_MATRIX, PRODUCTION_VALIDATION,
  REMAINING_RISKS, CHANGELOG, ACCEPTANCE_REPORT.

### Validation after every change

`npx tsc --noEmit` PASS · `npm run lint` 0 errors · `npm test` 406 PASS ·
`npm run build` PASS (29/29 pages).

### Deliberately NOT changed

- No product rewrite; export/auth/payment flows preserved.
- esbuild dev-only moderate advisory left (fix = breaking vitest major).
- In-memory rate limiter kept (documented threshold + Redis recommendation).
- cashfree `PRAGMA OFF` last-resort fallback kept (self-restoring; logged
  as P2 to monitor).
