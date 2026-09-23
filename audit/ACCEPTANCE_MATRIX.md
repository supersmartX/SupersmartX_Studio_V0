# SUPERSMARTX — ACCEPTANCE MATRIX

Legend: PASS (evidence cited) / FAIL / PARTIAL / NOT VERIFIED / N/A.
Baseline: 2026-09-22. Final update: 2026-09-22 (post-fix validation:
tsc PASS, lint 0 errors, 406/406 tests PASS, build 29/29 PASS).

| Area | Requirement | Current State | Evidence | Status |
| ---- | ----------- | ------------- | -------- | ------ |
| Auth | Login secure (bcrypt, lockout, validation) | bcrypt store, 5-fail/15-min lockout, strength rules, generic failures | src/auth.ts:80-93, lib/db lockout fns, lib/validation.ts, user-store/security suites | PASS |
| Auth | Session invalidation | session_version bump on reset; jwt callback nulls mismatched tokens | src/auth.ts:144-148, schema v8 | PASS |
| Auth | OAuth stub keeps FK consistent | Stub insert + token-id alignment | src/auth.ts:108-130 | PARTIAL (prod round-trip in PRODUCTION_VALIDATION.md) |
| Authorization | Ownership enforced | All resource reads scoped by session id | download:62, exports/[id]:14,39, export-jobs/[id]:23, preview:16, complete:37,49 | PASS |
| Authorization | No IDOR in production paths | Key-prefix + traversal checks; 404 (not 403) on foreign ids | complete:37, download:43-45, export-jobs PATCH prefix check (new) | PASS |
| Entitlements | Server enforced | DB plan + isPlanActive + getEntitlements on every mutating route | presigned-put, complete, export-upload, download, consume-quota | PASS |
| Entitlements | Tamper-proof (forged plan/resolution/platform/duration/quota) | 12 tamper tests green | server-authoritative.test.ts | PASS |
| Export | Upload authorized + validated | allowlist, mp4-only, 200 MB, concurrency 3, rate-limited | export-upload, presigned-put | PASS |
| Download | Ownership + entitlement enforced | plan-active + canDownload + atomic quota + 30/h limit | download/route.ts | PASS |
| R2 | Objects private, keys namespaced | Server-generated `exports/{uid}/{uuid}.mp4`; signed URLs only, no public URL construction | lib/r2.ts:122-160 | PASS (source); bucket policy NOT VERIFIED prod |
| R2 | Signed URLs authorized + expiring | Checks before signing; PUT 900 s, GET default 3600 s | lib/r2.ts:92-106, download:86 | PASS |
| R2 | Orphan handling | Quota-fail object delete + counter revert; deletion sweep; SET NULL on job cleanup | complete:77,88,106-108; export-upload:198,216; user/delete; schema v10 | PASS |
| Database | Critical constraints | FK pragma ON every connection; v10 SET NULL/CASCADE; PK/unique/indexes throughout | db/index.ts ensureMigrated; schema.ts v10; db-constraints.test.ts (5) | PASS |
| Database | Race-safe counters | Single-statement atomic UPDATEs; concurrent-increment test capped at limit | atomic helpers; server-authoritative quota tests | PASS |
| Reliability | Retry safe | Idempotent complete; webhook DB dedupe | complete:44-47; webhook:81-84 | PASS |
| Reliability | Failure cleanup | Covered quota/R2/user-delete/cleanup paths; frontend revokes URLs/stops tracks | routes + EXPORT_PIPELINE.md hygiene audit | PASS |
| Testing | Critical paths covered | 410 tests: auth, authz, ownership, entitlements, export, download, R2 keys, DB, API, quotas, recovery, health traceability | npm test | PASS |
| CI/CD | Build verified (lint→typecheck→test→e2e→build) | ci.yml gates; local gates green on Next 16.3.6 | .github/workflows/ci.yml | PASS |
| CI/CD | Migrations + rollback safe | Idempotent migrate(); v10 re-runnable; rollback doc | schema.ts; docs/ROLLBACK.md | PASS |
| Observability | Failures diagnosable, no secret logging | request-id, hashed user ids, generic surfaces, secret redaction in order route | middleware:19; observe/logger.ts; cashfree/order:87 | PASS |
| Documentation | Handover ready | 13 engineering docs + 6 audit records | docs/*.md; audit/*.md | PASS |
| Performance | Bottlenecks identified | Evidence review: indexed queries, 100-row cap, 200 MB cap, client encode; no speculative changes | build output; schema indexes | PARTIAL (prod perf checks open) |
| Scalability | Thresholds documented | In-memory limiter + multipart + encode ceilings with user-count thresholds | REMAINING_RISKS.md; STORAGE.md | PARTIAL (load tests open) |
| Dependencies | No known critical/high in prod paths | Next 16.3.6 (RCE fixed), prod audit 0 vulns; dev-only esbuild moderate deferred | npm audit --omit=dev; CHANGELOG.md | PASS |

## Gate rollup (final)

- Gate A (Build): PASS — build, tsc, lint(0 errors).
- Gate B (Tests): PASS — 406/406 + no unexplained regression (389→406).
- Gate C (Security): PASS source-level; PARTIAL overall (prod-env OAuth/R2-policy/Cashfree delivery open, tracked).
- Gate D (Data): PASS — pragma + v10 + cascade/SET NULL tests.
- Gate E (Storage): PASS source-level; PARTIAL overall (bucket policy prod-only).
- Gate F (Reliability): PASS.
- Gate G (Operations): PASS (docs + CI); first prod deploy + cron fire open.
- Gate H (Handover): PASS — clone→install→configure→run→test→build→deploy documented.
