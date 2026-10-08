# SupersmartX Studio — Architecture

Interactive teleprompter + video script reader with in-browser recording,
client-side MP4 export (MediaBunny), Cloudflare R2 storage, and Cashfree
subscriptions. Next.js 16 App Router, React 19, Tailwind 4.

## Layer 3 overview (Step 3)

### Frontend (`src/app/` pages, `src/components/`, `src/hooks/`)

- **Stack**: Next.js 16 App Router + React 19 + TypeScript + Tailwind 4.
- **Studio lifecycle**: teleprompter (prompter clock, Free 180 s/session) →
  record (`useCamera`/`useRecordingTimer`/`useRecorder`) → review
  (canvas review, audio review, mic mute sync) → export (ExportModal →
  `useExportPipeline` → MediaBunny encode → MP4 Blob → upload → library).
- **State ownership**: browser-only state (recording buffer, script snapshots,
  local exports) lives in IndexedDB (`recording-store`, `local-exports-store`);
  it never becomes server authority — see `DATA-OWNERSHIP.md`.
- **Navigation model**: `TabType = 'studio' | 'library'` (no insights tab);
  modal animations include swipe-to-close (`swipeHandlers` in AuthModal,
  ExportModal, PricingModal).

### Backend (`src/app/api/` route handlers, `src/middleware.ts`, `src/lib/`)

- **API**: **25 route files** under `src/app/api/` — auth/session, forgot/reset
  password, Cashfree order/verify/webhook, download, health, observe
  client-error, feedback, recordings, user stats/delete, exports (list, by id,
  preview, consume-quota, presigned-put, complete), export-upload, export-jobs
  (create, status patch, poll, cleanup). Full per-route contracts:
  `API-CONTRACTS.md`.
- **Auth**: NextAuth credentials + optional Google OAuth; edge gate in
  `middleware.ts` (JWT with user id required; `PUBLIC_API_ROUTES` allowlist of
  7); every session route re-reads the user from DB — plan never comes from the
  JWT (`AUTHENTICATION.md`, `AUTHORIZATION.md`).
- **Payments**: Cashfree hosted checkout — server-priced order (`pricing.ts`,
  geo header), `pending_orders`, webhook HMAC (`CASHFREE_SECRET_KEY` as signing
  key), atomic activation + `processed_webhooks` replay ledger.
- **Export jobs**: job state machine (`pending → encoding → uploading →
  completed|failed`) where `completed` is server-only; Phase 3 artifact
  verification in `/api/exports/complete` (final authority over bytes).
- **R2**: presigned single-key uploads (900 s, video/mp4), signed GET downloads
  (3600 s), owner-prefixed keys; 503 fail-closed when unconfigured.
- **DB**: Turso/libSQL via `src/lib/db` — versioned migrations, current
  `SCHEMA_VERSION = 14` (**v1–v14**, 12 tables), additive-only;
  production **fails closed** (`DatabaseNotConfiguredError`) without Turso.
- **Rate limiting**: per-process in-memory (`src/lib/rate-limit.ts`), keyed per
  user or per IP; not distributed (accepted limitation, FC-1.1 §11).

### External services

| Service | Role | Doc |
| ------- | ---- | --- |
| Turso (libSQL) | Durable database | `DATABASE.md` |
| Cloudflare R2 | Export MP4 storage (+ bucket CORS) | `STORAGE.md` |
| Cashfree | Payments (order/verify/webhook) | `ENVIRONMENT.md` |
| Resend | Receipt/reset email (best-effort) | `ENVIRONMENT.md` |
| Vercel | Hosting, cron (`0 2 * * *` cleanup), env, logs | `DEPLOYMENT.md`, `PRODUCTION-RUNBOOK.md` |

### Authority boundaries

| Layer | Authoritative for | Never authoritative for |
| ----- | ----------------- | ----------------------- |
| Browser | UX state, script snapshots, upload *claims* (duration, fileSize, hasAudio) | plan, quotas, ownership, artifact validity, completion |
| Server (API routes) | entitlements, validation/clamping, artifact verification, signed URLs, activation | — |
| Database | identity, plan/expiry, orders, export records, quota ledgers | file bytes |
| R2 | export bytes (`headObject` size/content-type/eTag) | ownership, plan |
| Cashfree | payment state (only source that activates a plan) | anything else |

## Runtime topology

```text
Browser (studio)                    Vercel (Next.js)                 External
───────────────                     ────────────────                 ────────
Teleprompter ─┐
Camera+Mic ───┼─► MediaRecorder ─► IndexedDB ─► MediaBunny encode ─► MP4 Blob ─┐
              │                                                                ├─► R2 (signed PUT or multipart)
AuthModal ────┼─► NextAuth (credentials/OAuth) ─► libSQL/Turso ────────────────┘
PricingModal ─┼─► /api/cashfree/order ─► Cashfree ─► webhook ─► plan activation
LibraryPanel ─┴─► /api/exports, /download, /preview (signed GET URLs)
```

## Key directories

- `src/app/` — routes: `/` (marketing), `/studio`, `/auth/reset-password`,
  `/api/*` (25 route files), `sitemap.ts`, `robots.ts`.
- `src/auth.ts` / `src/auth.config.ts` — NextAuth config (node vs edge-safe split).
- `src/middleware.ts` — API JWT gate + `x-request-id` propagation.
- `src/lib/db/` — `driver.ts` (libSQL client singleton; **fails closed** in
  production), `schema.ts` (versioned migrations v1–v14, `SCHEMA_VERSION = 14`,
  12 tables), `index.ts` (queries + atomic counters),
  `migrate.ts` (JSON→DB one-shot migration).
- `src/lib/` — `entitlements.ts` (plan contract), `r2.ts` (storage),
  `rate-limit.ts` (in-memory limiter), `pricing.ts` (server prices),
  `cashfree.ts`, `email.ts` (Resend), `validation.ts`, `user-store.ts`,
  `observe/logger.ts`, `export/*` (encode pipeline), `recording-store.ts`,
  `local-exports-store.ts` (IndexedDB).
- `src/hooks/` — `useExportPipeline`, `useRecorder`, `useCamera`,
  `useMasterRecording`, `useRecordingTimer`, UI hooks.
- `src/__tests__/` — 69 vitest suites (1067 tests; certified Phase 3 baseline,
  see `TESTING.md`). `e2e/` — Playwright (15 spec files).
- `audit/` — acceptance program records. `docs/` — handover docs; the doc map
  lives in `docs/CHANGE-CONTROL.md` §The rule and `docs/TRACEABILITY.md`.

## Server-authoritative boundaries

The client NEVER decides: plan, resolution ceiling, platform access, crop
permission, duration limit, quota counts, storage usage, price, order amount.
Every mutating API route loads the user from DB by session id and derives
entitlements via `getEntitlements` + `isPlanActive`. See ENTITLEMENTS.md.

## Data stores

| Store | Purpose | Durability |
| ----- | ------- | ---------- |
| Turso (libSQL) / local SQLite | users, plans, exports, jobs, quotas, orders, webhooks | Primary system of record |
| Cloudflare R2 | exported MP4s | Content; DB holds authoritative refs |
| IndexedDB (browser) | in-progress recordings, local exports | Ephemeral; recoverable via re-export |
| JSON files (legacy) | pre-DB user/token store | Migration source only (`migrate.ts`) |

## Background work

- `POST /api/export-jobs/cleanup` (secret-gated, Vercel cron `0 2 * * *`)
  deletes jobs older than 30 days + their R2 objects. `exports.job_id` is
  `ON DELETE SET NULL`, so completed exports survive job cleanup.
