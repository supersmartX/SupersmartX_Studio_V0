# Data Ownership — SupersmartX Studio

> Phase 4 deliverable. Per application state: where it is authoritative, who
> reads it, who writes it, and which trust boundary guards it. Derived from the
> implementation (`src/lib/db/schema.ts`, `src/lib/r2.ts`, `src/lib/*-store.ts`,
> API routes) as read during Phase 4.

## Authority model (who wins)

| Layer | Authority | Never authoritative for |
| ----- | --------- | ----------------------- |
| **Browser** (JS memory, localStorage, IndexedDB) | UX state: teleprompter position, modal state, local draft recordings, client-side duration/progress *claims*, cached entitlement display | plan, resolution ceiling, platform access, crop permission, quota counts, storage usage, price, order amount, export completion, artifact validity |
| **Server** (Next.js route handlers) | Entitlements (`getEntitlements` + `isPlanActive`), validated export config, quota charges, artifact verification, payment fulfilment, signed URLs | — (it is the only writer for all of the below except browser-only state) |
| **Database** (Turso/libSQL) | Durable system of record: users, plans, orders, export rows, job state, quotas, tombstones | file bytes (R2 holds them), session validity (JWT does) |
| **R2** (Cloudflare) | Export MP4 bytes + metadata (`headObject` size/content-type/eTag are what `complete` verifies) | ownership, plan, quota — those live in the DB |
| **External** (Cashfree) | Order payment state (`PAID`/terminal failure) — the only source that activates a plan | anything else |

Schema history: `MIGRATION_LEDGER` versions **1–14** (`SCHEMA_VERSION = 14`),
12 tables. Additive migrations only; v10 rebuilt `exports`/`user_stats`.

---

## Recording state

| State | SOURCE OF TRUTH | READERS | WRITERS | TRUST BOUNDARY |
| ----- | --------------- | ------- | ------- | -------------- |
| Raw camera/mic capture | Browser `MediaRecorder` (in-memory chunk stream) | Encoder (`useExportPipeline` → MediaBunny) | `useRecorder`/`useCamera` hooks | Browser-only; never sent raw to the server — only the encoded MP4 artifact crosses the network |
| In-progress recording (crash recovery) | Browser IndexedDB `recording-store` (`src/lib/recording-store.ts`, DB version 2) | Studio resume flow | `useMasterRecording` + recorder hooks | Browser-only, ephemeral, explicitly "recoverable via re-export" |
| **Script snapshot on the recording** (`MasterRecording.script`, DC-1) | IndexedDB at capture time — the take's script is frozen, not re-read live | Export pipeline (renders the take's own script), library detail view | `useMasterRecording` at stop-time | Browser-only. The DB has no script column; nothing server-side reads it. A resumed script edit never mutates past takes |
| Master recording metadata (duration, hasAudio, dimensions, crop) | Browser IndexedDB claim at capture; **re-derived from actual bytes** server-side at completion | Encoder; `/api/exports/complete` (`duration`, `hasAudio` are *claims* it verifies against the artifact) | Recorder hooks (claim); server verifier (authority) | Client claim ≤ server verification: charge = `max(claim, byte-floor)`; `hasAudio` claim must match the artifact's audio track |
| Daily recording budget ledger | **DB** `daily_recording_seconds` (BUS-001) | `/api/exports/complete` (atomic consume), quota reverts | Server only, at export completion | Server-authoritative; localStorage client ledger is a UX hint only (`entitlements.ts` comment) |
| Teleprompter session usage (Free 180 s/session, 600 s/day) | Browser (client countdown) + server daily budget at export time | UI countdown | Teleprompter hooks | Client-side enforcement UX; the durable charge is the server daily budget |
| Cloud raw recordings (`recordings/{userId}/` keys) | R2 | `/api/recordings` (prefix-listed) | **No active writer today** — `generateRecordingKey` has no caller (finding F-12) | Key prefix is bound to the session user; R2 list never crosses users |

## `recordings/` prefix inventory — Phase 5 WS-D (read-only, 2026-10-08)

**Code side (verified against the Phase 5 working tree):**

| Concern | Fact at HEAD |
| ------- | ------------ |
| Key format | `recordings/{userId}/{uuid}.{webm\|mp4}` (`generateRecordingKey`, `src/lib/r2.ts`) |
| Writers | **None in production.** `generateRecordingKey` has no caller outside `security.test` (F-12 re-confirmed in Phase 5) |
| Readers | `GET /api/recordings` — session-bound `ListObjectsV2` on `recordings/{ownUserId}/`; `401` without a session, `[]` when R2 is unconfigured |
| Deletion | **None for this prefix.** `/api/user/delete` lists and deletes only `exports/{userId}/`; the nightly cron touches `staging/` + `export_jobs` only (F-13). `observe/logger` redacts `recordings/` keys from logs |
| Cross-user exposure | None — the list prefix is bound to the session user, and no route serves another user's prefix |

**Bucket side (attempted, NOT completed — ops-access gap):**

- A read-only `ListObjectsV2` against the configured bucket was attempted from
  the Phase 5 environment. Credentials are present in `.env.local`
  (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
  `R2_BUCKET_NAME`), but the listing failed for two independent, observed
  reasons: (1) outbound TLS to `*.r2.cloudflarestorage.com` is rejected from
  this environment (OpenSSL alert 40 `handshake_failure`, reproducible for any
  subdomain of the zone, while a control request to `cloudflare.com`
  succeeds); (2) the configured `R2_ACCOUNT_ID` is a 34-character mixed-case
  value that does not match the 32-hex shape an
  `https://<id>.r2.cloudflarestorage.com` endpoint requires, and resolves
  inconsistently between resolvers.
- **Consequence:** whether historical objects exist under `recordings/` is
  *unverified* from this environment. Ops-side verification (a conforming
  account ID on an unrestricted network) is required; bucket/policy inventory
  stays deferred to Phase 6 (F-12). Phase 5 made **zero** bucket writes,
  deletes, or policy changes — the only outbound calls attempted were
  `ListObjectsV2` and DNS probes, and the temporary inventory script was
  removed after the attempt.

## Export state

| State | SOURCE OF TRUTH | READERS | WRITERS | TRUST BOUNDARY |
| ----- | --------------- | ------- | ------- | -------------- |
| Export job lifecycle (`pending → encoding → uploading → completed/failed`) | DB `export_jobs.status` | Client polls `GET /api/export-jobs/[id]/status` | Server: `createExportJob` (create), `atomicFinalizeExport` (complete), cleanup cron (delete). Client: `PATCH` only along `pending→encoding→uploading→failed` (+ same-status progress) — `completed` is deliberately absent | Client cannot write completion, result keys, or file state (`PATCH` accepts only `status/progress/errorMessage`) |
| Job config (platform, dimensions, duration, crop, hasAudio) | DB `export_jobs.config_json` — written from **server-clamped preset** at creation | `/complete` re-reads it as the authoritative platform/dimensions | `createExportJob` / `presigned-put` (both clamp server-side) | Client config input is validated or rejected (`400`), never trusted |
| Staging object (`staging/{userId}/{jobId}.mp4`) | R2 (byte authority) + DB `export_jobs.staging_r2_key` (binding) | `/complete` (`headObject`, ranged `getObjectRange`) | Browser via presigned PUT (900 s URL, `video/mp4` only) or multipart `/api/export-upload`; deleted by `complete`/failure paths/cleanup | Key must match the job row and the caller's prefix — cross-user keys `403`; presigned URL can write **only** that one staging object |
| Artifact validity (structure, dimensions, duration, audio, size) | **The bytes in R2** — `verifyExportArtifact` over `collectMp4Metadata` (Phase 3) | `/complete` before any write | Server verifier only | Server = final authority; claims are inputs. Failure deletes staging, job stays `uploading` (retryable); IO errors → `500` with object kept |
| Completed export record | DB `exports` row (id, user_id, r2_key, platform, w/h, file_size, mime, status, job_id) | Library UI (`GET /api/exports`, `GET /api/exports/[id]`), download, preview, user-delete, cleanup exclusion | `atomicFinalizeExport` (single writer), legacy `export-upload` | All lookups `WHERE user_id = ?`; `exports.job_id` is `ON DELETE SET NULL` so job cleanup never removes library rows |
| Final MP4 (`exports/{userId}/{jobId}.mp4`) | R2 bytes; DB row holds the authoritative ref | Download/preview signed URLs (3600 s), user-delete | `complete` (copy from staging), legacy multipart | Signed URL is minted only for keys inside the caller's own prefix; `local/` and foreign keys 404 like missing rows |
| Local (Free) export | Browser IndexedDB `local-exports-store` + `exports` row with `local/…` key | Library UI | Client write path | No R2 object exists: download/preview 404/400 them by design; Free users are rejected from both cloud upload routes **before** quota logic (finding F-01) |
| Upload/download/monthly counters | DB `user_stats` (`upload_count`, `download_count`, `storage_bytes`), `monthly_export_counts` | `GET /api/user/stats`, quota checks | Server atomic increments/reverts only | Counter writes are conditional (`atomic*`); denied consumes consume nothing |
| Export download authorization | DB (`exports` row + `user_stats`) + entitlements | `/api/download` | Server | Owner `404`s, completed-only, non-`local/`, own-prefix; sign-before-consume so R2 failure never burns a credit |

## Account state

| State | SOURCE OF TRUTH | READERS | WRITERS | TRUST BOUNDARY |
| ----- | --------------- | ------- | ------- | -------------- |
| Identity (`users.id`, email, name, password hash) | DB `users` | Session resolution (`findUserById` on every route), payments (by id **or** email), `recordDeletedIdentity` | Signup/NextAuth, OAuth stub creation in `cashfree/order`, `updateUserPassword` | Password hash never leaves the server; login/ forgot / reset are rate-limited per IP |
| Plan + entitlements (`plan`, `planExpiresAt`) | DB `users` row — read from DB, **never from the JWT** | Every route via `getEntitlements` + `isPlanActive`; `GET /api/user/stats` (expired reported as `free`) | Payment fulfilment only (`fulfillPaidOrder` from webhook/verify) | `isPlanActive`: free always active; paid without a future expiry **fails closed**. Expired → every route answers `403` |
| Session | Signed JWT (NextAuth) with `id`, `plan`, `sessionVersion` (plan re-derived on callback) | Middleware edge gate (`token.id` required), `auth()` in routes | NextAuth sign-in/logout, `session_version` bumps | JWT is never used alone for quota/entitlement decisions — every route re-reads plan + counters from the DB row (`AUTHENTICATION.md`) |
| Deleted-identity tombstone | DB `deleted_identities` (email → next session version) | Session resolution fallback | `user/delete` (`recordDeletedIdentity`) | Fail closed: if the tombstone write fails, the whole deletion aborts `500` and the user row stays (otherwise an old cookie could be handed to a future re-registration) |
| Password reset token | DB `reset_tokens` (SHA-256 hash, 1 h expiry) | `consumeResetToken` (atomic single-use) | `forgot-password` (last token wins) | Raw token only in the emailed link; hash at rest; single-use defeats replay |
| Payment orders | DB `pending_orders` (plan, **server-priced** amount, currency) + Cashfree order state | `verify`, `webhook` (amount/currency re-verified against this row) | `cashfree/order` (create), fulfilment (activate) | One payable order at a time; activation only from Cashfree's authoritative state — never from `?payment=success`; foreign order answers `404` |
| Webhook replay ledger | DB `processed_webhooks` | Webhook dedupe check | Webhook handler (mark on terminal paid only) | Dedupe keyed by order id; non-terminal events unmarked so their retry still runs |
| Quota ledgers (Free daily/monthly budgets) | `monthly_export_counts`, `daily_recording_seconds`, `user_stats` | Atomic consume functions, `/api/user/stats` | Server only | Conditional atomics + revert-on-failure |
| Rate-limit windows | In-process memory (`rateLimit.ts`, `globalThis` maps) | Limiter | Limiter | Ephemeral per instance — resets on deploy/cold start (documented limitation) |
| Email receipts / admin alerts | Best-effort (`email.ts` via Resend, `Promise.allSettled`) | Buyer, `ADMIN_EMAIL` | Fulfilment paths | Never on the activation critical path — a mail failure cannot block or roll back a plan write |
| Feedback | `DISCORD_WEBHOOK_URL` target only (no DB row) | Discord channel | `POST /api/feedback` (sanitised, 500 chars) | Optional feature: unconfigured → `503`; user id shown truncated |

## Trust-boundary diagram

```text
 Browser (untrusted)          Server (authoritative)         Durable stores
─────────────────────         ───────────────────────        ─────────────────────────
 claims: duration,      →    validate/clamp/verify      →   DB: users, plans, orders,
   fileSize, hasAudio,        against presets +              export_jobs, exports,
   platform, progress,        entitlements + artifact         quotas, tombstones
   status (limited)           verification
 local/ library rows    →    (no server effect for            R2: bytes (staging → final),
 IndexedDB script            Free-local exports)              signed URLs (3600 s)
 presigned PUT URL      →    single-key, video/mp4,
   (browser upload)           900 s, own prefix
 ?payment=success       →    ignored; Cashfree order
   (attacker-controllable)    state decides activation
```

## Rules for maintainers

1. New state must declare all four columns (source of truth / readers / writers /
   trust boundary) here before it ships.
2. The client may *propose*; only the server may *decide*. If a new client field
   would change money, quota, ownership, or file validity, it must be re-derived
   server-side.
3. Ownership queries always include `user_id = ?`. A missing row and a foreign
   row must be indistinguishable (`404`, never `403`).
4. Never store secret values in any layer documented here — variable names only.
