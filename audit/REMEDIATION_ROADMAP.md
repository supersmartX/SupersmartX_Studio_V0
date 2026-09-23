# REMEDIATION ROADMAP

Format per item: Issue / Files / Why / Fix / Effort / Dependencies /
Validation. No remediation executed (audit-only).

## Phase 0 — Immediate (days; pre-ownership conditions)

1. SEC-001 verified-size cap. Files: complete/route.ts, r2.ts (types),
   new test. Why: unbounded paid storage. Fix: 413 on verifiedSize>MAX +
   object delete + mock-headObject test. Effort: Small. Deps: none.
   Validation: tamper test (lie fileSize, big object) + full gates.
2. BUS-001 server seconds ledger. Files: schema (new table/migration v11),
   complete + export-upload routes, daily-recording.ts (hint only), tests.
   Why: pricing control bypass. Fix: atomic per-user-day seconds counter,
   reject over-budget. Effort: Medium. Deps: migration discipline.
   Validation: budget-exhaustion + revert tests + gates.
3. SEC-003 PAT rotation. Files: none (console). Why: repo push-access
   hygiene. Fix: rotate, gh auth, scope audit. Effort: Small. Deps: owner.
   Validation: old token dead, remotes clean.
4. SEC-004 R2 privacy proof. Files: none (console + synthetic). Why:
   world-read exposure class. Fix: verify private, add negative probe.
   Effort: Small. Deps: Cloudflare access. Validation: anon GET denies.

## Phase 1 — Pre-Acquisition (1–3 weeks)

5. OPS-001 backups/RPO drill (console + docs). Deps: Turso access.
   Validation: restore row-count evidence in audit/.
6. COST-001/002 ceilings + alerts (entitlements + complete + dashboards).
   Deps: SEC-001. Validation: cap tests + alert screenshots.
7. OPS-002 + OBS-001 Redis limiter + Sentry + uptime synthetics. Deps:
   Upstash/vendor accounts. Validation: cold-start limit test, alert fire.
8. SEC-002 pin next-auth exact + stable-migration plan. Deps: Auth.js
   releases. Validation: auth suite green on pinned/migrated version.
9. INFRA-001 evidence pack (branch protection, env scoping, access list).
   Deps: provider consoles. Validation: screenshots in audit/.
10. TEST-001 route-level tamper suite + legacy-migration fixture + CSP
    snapshot. Deps: none. Validation: suite fails if SEC-001 reintroduced
    (mutation check).

## Phase 2 — Stabilization (month 2)

11. ARCH-001 studio decomposition (no behavior change) + FE-002 store
    decision. Validation: e2e + full suite green.
12. PERF-001 code-split studio/export engine, vendor chunk, perf budgets.
    Validation: chunk sizes in CI, LCP improvement.
13. API-001/002/003 + DB-001/002/003 + STO-001 hardening batch + orphan
    sweep for never-completed PUTs. Validation: route tests.
14. DOC-001 API reference + retention/rotation/Cashfree runbooks + ADRs.
15. QUAL-001..004 lint/dead-code/dedupe/bloat cleanup. Validation: gates.

## Phase 3 — Scale Readiness (quarter)

16. SCALE-001 presigned-by-default uploads, server-encode queue design +
    cost model, pagination, cleanup batching. Validation: load tests at
    10x synthetic traffic.
17. DB read/counter strategy (Redis counters, replica reads) past 10k.
    Validation: contention benchmarks.

## Phase 4 — Long-Term

18. SEC-005/006/007/009 auth hardening bundle + MFA; SEC-008 privacy
    register; FE-001 a11y pass; trustHost/MFA decisions.
19. 100x partitioning/multi-region/CDN planning (design only until needed).
