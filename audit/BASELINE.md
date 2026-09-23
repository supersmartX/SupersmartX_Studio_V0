# SUPERSMARTX — BASELINE (Production Acceptance Program)

Date: 2026-09-22 (UTC)
Commit baseline: uncommitted-tree inspection; no modifications made prior to this file.
Method: source inspection + `npx tsc --noEmit` + `npm run lint` + `npm test` + `npm run build`.

## Build

- `npm run build` (Next 16.3, 11 workers): **PASS** — compiled successfully, TypeScript finished, 29/29 static pages generated.
- Note: build warns `Missing required environment variable: CASHFREE_SECRET_KEY` (expected without env) and a Next.js deprecation notice recommending `proxy` over the `middleware` file convention (src/middleware.ts). No action taken yet.

## TypeScript

- `npx tsc --noEmit`: **PASS** — zero errors.

## Lint

- `npm run lint` (eslint 9, eslint-config-next): **PASS with warnings** — 0 errors, 28 warnings.
- Warnings are unused vars/args, one unused eslint-disable directive, two `no-console` (console.log in src/auth.ts:29, src/lib/observe/logger.ts:51).
- Full list captured in tool output; no error-level findings.

## Tests

- `npm test` (vitest run): **PASS** — 21 test files, 389 tests, all passed (duration ~19s).
- React `act(...)` stderr noise in useExportPipeline tests; non-failing.
- e2e (playwright) not executed in baseline (requires browsers + env).

## Known failures

- None. No pre-existing build/type/test/lint errors.

## Architecture

- Next.js 16 App Router + React 19 + Tailwind 4. Routes: `/` marketing, `/studio` app, `/auth/reset-password`, legal, sitemap/robots.
- Auth: NextAuth v5 (Auth.js). Credentials provider (bcrypt via user-store) + optional Google OAuth. JWT strategy 30d sliding window, `sessionVersion` column for password-reset invalidation, 5-fail lockout. `src/middleware.ts` (matcher `/api/:path*`) enforces JWT presence (401) except public routes: `/api/auth/*`, forgot/reset-password, cashfree webhook, health, observe/client-error.
- Per-route authorization: all inspected protected routes call `auth()`, load user from DB by session id, check `isPlanActive`, check `getEntitlements`, and scope resource access by user (`findExportByIdAndUser`, `findExportJobByIdAndUser`). No IDOR found in reviewed paths.
- DB: libSQL (local SQLite file `data/supersmartx.db`, Turso in prod). Versioned migrations v1–v9 (users, reset_tokens, user_stats, exports, export_jobs, processed_webhooks, pending_orders, monthly_export_counts + lockout/session_version columns). `migrate()` idempotent via schema_meta.
- Storage: Cloudflare R2 via @aws-sdk/client-s3. Keys namespaced `exports/{userId}/{uuid}.mp4`, `recordings/{userId}/{uuid}.{webm,mp4}`. Signed PUT (15 min) + signed GET (configurable TTL, default 3600s).
- Export pipeline: client-side MediaBunny encode → either direct presigned PUT + `/api/exports/complete` (Creator), or multipart `/api/export-upload` (all plans). Quotas enforced atomically (`atomicTryConsumeMonthlyExport`, `atomicIncrementUploadCount`); orphan-object cleanup on quota failure.
- Payments: Cashfree. `/api/cashfree/order` derives price server-side (geo-resolved, client arbitrage rejected), stores `pending_orders`; `/api/cashfree/webhook` verifies HMAC-SHA256 signature, re-fetches order status, verifies amount/currency, DB-backed idempotency (`processed_webhooks`).
- Observability: `src/lib/observe/logger.ts` (request-id, user-id hashing, no credential logging observed) + `/api/observe/client-error` ingestion + health endpoint.
- CI: `.github/workflows/ci.yml` — lint, typecheck, test, then e2e + build (needs lint/typecheck/test). `nightly.yml` present (not inspected in detail yet).

## Critical workflows

1. Signup/login/logout/password-reset (+ optional Google OAuth).
2. Cashfree order → webhook → plan activation → expiry.
3. Studio record (MediaRecorder) → client encode → upload (presigned or multipart) → complete → exports list → signed-URL download/preview.
4. Export jobs state machine (pending→encoding→uploading→completed, failure branches) + nightly cleanup cron (`/api/export-jobs/cleanup` via vercel.json).
5. Account deletion (R2 objects + DB rows).

## Known risks (to verify/harden during program)

1. **R1 (P1, data integrity): SQLite FK enforcement never enabled.** `src/lib/db/driver.ts` creates the libSQL client but never runs `PRAGMA foreign_keys = ON`. SQLite/libSQL defaults FK enforcement OFF per connection, so `ON DELETE CASCADE` in schema is unenforced at the DB layer. Impact is partially contained (user/delete route manually deletes children), but DB-level guarantee is absent. Evidence: driver.ts has no PRAGMA statement; cashfree/order route contains a `PRAGMA foreign_keys = OFF/ON` fallback toggle, proving enforcement state is assumed, not established.
2. **R2 (P2, integrity): `PATCH /api/export-jobs/[id]` accepts client-supplied `resultR2Key`/`resultExportId` without ownership-prefix validation.** Ownership of the job is checked, but a client could store an arbitrary key string. Downstream `complete` validates key-match, limiting exploitability — still harden with `exports/{userId}/` prefix check.
3. **R3 (P2, scalability): in-memory rate limiter** (`src/lib/rate-limit.ts`; per-isolate Map, cold-start reset). Documented in code; ineffective as a distributed control on serverless. Note as scale threshold; recommend Redis-backed limiter beyond single-instance scale.
4. **R4 (P3): `middleware` file-convention deprecation** (Next.js suggests `proxy`). Cosmetic/forward-compat; low priority.
5. **R5 (verify in prod only):** R2 bucket privacy, signed-URL expiry behavior, OAuth round-trip, Cashfree webhook delivery, email delivery, Turso connectivity — cannot be verified from source; listed in PRODUCTION_VALIDATION.md.
