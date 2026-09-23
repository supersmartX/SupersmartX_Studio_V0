# SupersmartX Studio — Architecture

Interactive teleprompter + video script reader with in-browser recording,
client-side MP4 export (MediaBunny), Cloudflare R2 storage, and Cashfree
subscriptions. Next.js 16 App Router, React 19, Tailwind 4.

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
  `/api/*` (24 route files), `sitemap.ts`, `robots.ts`.
- `src/auth.ts` / `src/auth.config.ts` — NextAuth config (node vs edge-safe split).
- `src/middleware.ts` — API JWT gate + `x-request-id` propagation.
- `src/lib/db/` — `driver.ts` (libSQL client singleton), `schema.ts`
  (versioned migrations v1–v10), `index.ts` (queries + atomic counters),
  `migrate.ts` (JSON→DB one-shot migration).
- `src/lib/` — `entitlements.ts` (plan contract), `r2.ts` (storage),
  `rate-limit.ts` (in-memory limiter), `pricing.ts` (server prices),
  `cashfree.ts`, `email.ts` (Resend), `validation.ts`, `user-store.ts`,
  `observe/logger.ts`, `export/*` (encode pipeline), `recording-store.ts`,
  `local-exports-store.ts` (IndexedDB).
- `src/hooks/` — `useExportPipeline`, `useRecorder`, `useCamera`,
  `useMasterRecording`, `useRecordingTimer`, UI hooks.
- `src/__tests__/` — 23 vitest suites (406 tests). `e2e/` — Playwright.
- `audit/` — acceptance program records. `docs/` — handover docs.

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
