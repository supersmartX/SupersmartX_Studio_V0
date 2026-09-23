# TESTING AUDIT

Counts: 24 suites, 410 tests, green; Playwright e2e present (env-gated);
nightly coverage (no thresholds). Quality over counts:

## Covered well

Auth (lockout, sessionVersion, password rules), entitlements matrix,
ownership scoping, atomic quota/counter concurrency, FK cascade/SET NULL,
tamper-at-entitlement-layer (12 tests), health traceability + anon-hiding,
recording timer/teleprompter, export composition, pricing.

## Gaps

- TEST-001 (P2): no HTTP-level route tests except health. If complete/
  export-upload/download validation order changes tomorrow, nothing fails.
  Lib-level tests assert helpers, not the wiring (e.g., SEC-001's missing
  verifiedSize check is invisible to the suite — the suite passes WITH the
  bug, which is precisely the hazard).
- E2E covers flows but needs browsers + secrets; not evidenced green in CI
  artifacts here.
- No load/chaos tests (upload retry storms, cleanup backlog, webhook
  floods).
- Coverage collected, no gates — dead-code drift possible (QUAL-002
  survived alongside coverage).

## What can silently break

1. Any route-handler edit (status codes, check ordering, quota interplay).
2. CSP/header edits in next.config.ts (lint-exempt, untested).
3. Migration edits (tested only via suites that rebuild from scratch —
   never against migrated legacy data with orphans).
4. Entitlement constant changes (caught) vs. their USE in new routes
   (not caught — no contract test binds plans to routes).

## Recommendation (TEST-001)

Route-level suite (mock auth/DB/R2) for complete/upload/download tamper
cases + a legacy-data migration fixture + CSP snapshot test. Medium effort.
