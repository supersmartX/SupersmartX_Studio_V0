# ARCHITECTURE AUDIT

Map:
```text
Application
├── Frontend: Next.js 16 App Router, React 19, Tailwind 4. Landing (page.tsx,
│   1049 lines) + Studio orchestrator (studio/page.tsx, 816 lines, ~14 hooks)
│   + panels/modals. No global store (prop-drilling + hook composition).
├── Authentication: NextAuth v5 beta (credentials bcrypt-12 + optional
│   Google), JWT 30d sliding, sessionVersion kill-switch, per-email lockout.
├── Authorization: edge JWT gate (middleware, /api/*) + per-route
│   auth→user→plan→entitlement→ownership-scoped query. Uniform, tested.
├── API: 24 route files, thin handlers, generic errors, request-ids.
├── Business Logic: centralized entitlements.ts + pricing.ts; atomic DB
│   counters; server-derived plans/prices/quotas (except duration/size gaps).
├── Database: libSQL singleton, v1–v10 migrations, FK enforced (pragma),
│   CASCADE/SET NULL, atomic UPDATE counters.
├── Storage: R2 via S3 SDK, owner-namespaced keys, signed PUT (900s) / GET
│   (3600s), multipart fallback through serverless functions.
├── Media/Export Pipeline: MediaRecorder → IndexedDB → MediaBunny (browser)
│   → presigned PUT or multipart → complete → exports row → signed download.
├── Infrastructure: Vercel (cron), Turso, Cloudflare R2, Cashfree, Resend,
│   Google OAuth. CI: lint→typecheck→test→e2e→build + nightly.
├── Observability: structured logs + client-error ingestion + request ids.
│   No APM/RUM/uptime.
├── Testing: 24 vitest suites (410), Playwright e2e (env-gated).
└── External Services: Cashfree, Resend, R2, Turso, Google, ipapi (client),
    Gravatar, Discord webhook (optional).
```

## Assessment (the 7 questions)

1. Understandable by a new team? Yes — docs/ (13) + audit/ + uniform route
   pattern; God components slow studio-area onboarding (ARCH-001).
2. Independent module change? Mostly — lib/ boundaries clean; studio
   orchestrator couples recording/export/payment UI (ARCH-001).
3. Business rules centralized? Yes — entitlements.ts/pricing.ts single
   sources; two gaps (SEC-001, BUS-001).
4. Infra leaking into logic? Minor — R2 key-shape knowledge in routes,
   `isR2Configured` branching in handlers; acceptable, not God-object.
5. Bottlenecks? Upload-through-function, browser encode, SQLite writer,
   un-paginated lists (SCALE-001, API-002).
6. Appropriate now? Yes for 100–1k users.
7. 10x pain? God orchestrators, no code-split bundle, serverless uploads,
   in-memory limits, logs-only ops (see SCALABILITY_AUDIT.md).

## Risk map

- High: none structural (no circular deps found; singletons are caches/flags).
- Medium: ARCH-001 God components (P2); FE-002 prop-drilling (P3, revisit on
  next studio feature, not now); duplicated limiter/keygen (QUAL-003, P3).
- Low: opaque job config blob (API-001); dormant quota path (DB-003);
  trustHost+long sessions (SEC-009).
- Debt ledger: 25 lint warnings (0 errors), 2 non-test `any` (catch
  clauses), 1 unused eslint-disable, tsconfig strict:true, no-explicit-any
  off (QUAL-001).
