# API Contracts — SupersmartX Studio

> Phase 4 deliverable. Every contract below is **derived strictly from the
> implementation** in `src/app/api/**/route.ts` and `src/middleware.ts`, as read
> during Phase 4. Where the code and other documents disagree, the mismatch is
> recorded in `TRACEABILITY.md` (Phase 4 Findings) — not silently reconciled
> here. Never document secret values; only variable names.

## Global conventions (apply to every route)

| Concern | Rule |
| ------- | ---- |
| Edge gate | `src/middleware.ts` matches `/api/*`. Every API request must carry a valid session JWT **with a user id**; missing/invalid → `401` before the route runs. `x-request-id` is stamped on every response. |
| Public routes (skip JWT gate only) | `middleware.ts` `PUBLIC_API_ROUTES`: `auth/forgot-password`, `auth/reset-password`, `auth/[...nextauth]`, `cashfree/webhook`, `health`, `observe/client-error`, `export-jobs/cleanup`. Routes still enforce their own checks (session, secret, validation). |
| Auth tier inside routes | Session routes call `auth()` and require `session.user.id`; then `findUserById` re-reads the user from DB (JWT is never trusted for plan state). |
| Owner check | All export/job/record lookups are `find…ByIdAndUser(id, userId)` — SQL `WHERE user_id = ?`. A foreign id is answered `404` (never `403`) so existence is not revealed. |
| Error shape | `{ "error": string }` with a status code. `429` responses carry `Retry-After` (seconds). Payment routes also carry `x-request-id`. |
| Rate limiter | In-memory per-process (`src/lib/rate-limit.ts`). Keyed per user id or per IP (last `x-forwarded-for` entry). Not distributed across serverless instances — a documented limitation, not a guarantee. |
| Idempotency | See per-route `IDEMPOTENCY` line. General model: replay-safe completion echoes, atomic single-use tokens, atomic webhook claims. |
| Server authority | Client inputs (`platformId`, `outputWidth/Height`, `duration`, `fileSize`, `hasAudio`, `crop`, `progress`, `status`) are claims to validate, never authorities. The DB row, the R2 object, and `getEntitlements()` decide. |

---

## 1. Authentication & session

### `GET /api/auth/session`
- **AUTH**: public at middleware; NextAuth handler resolves cookie session.
- **INPUT**: session cookie. **SERVER VALIDATION**: JWT signature + session version.
- **OWNER CHECK**: n/a. **DB/R2 EFFECT**: reads session record (edge JWT — no DB hit for JWT strategy).
- **SUCCESS**: `200` session object (or `{}` when anonymous).
- **FAILURES**: none beyond NextAuth defaults. **RATE LIMIT**: none. **IDEMPOTENCY**: read-only.

### `/api/auth/[...nextauth]` — `GET`, `POST`
- **AUTH**: public at middleware (login/callback flow).
- **INPUT**: credentials (login POST), OAuth callback params.
- **SERVER VALIDATION**: NextAuth credentials provider; `src/auth.ts` refuses to start in production without `AUTH_SECRET`/`NEXTAUTH_SECRET` (≥32 chars).
- **OWNER CHECK**: user looked up by email; password hash compared with scrypt.
- **DB/R2 EFFECT**: reads `users`; writes nothing on GET.
- **SUCCESS**: `200` session/redirect per NextAuth.
- **FAILURES**: `401` invalid credentials. **RATE LIMIT**: `POST` wrapped — 10 attempts / 15 min per IP (last XFF entry), else `429` + `Retry-After`.
- **IDEMPOTENCY**: n/a (login is stateless per attempt).

### `POST /api/auth/forgot-password`
- **AUTH**: public; IP rate limit is the abuse control.
- **INPUT**: `{ email }`.
- **SERVER VALIDATION**: regex `^[^\s@]+@[^\s@]+\.[^\s@]+$`; unknown address still returns success (anti-enumeration).
- **OWNER CHECK**: n/a.
- **DB/R2 EFFECT**: writes `reset_tokens` row (SHA-256 of a 32-byte random token, 1-hour expiry, replaces prior token); sends email via Resend (best-effort; failures logged, response unchanged).
- **SUCCESS**: `200 { ok: true }` — identical body whether or not the account exists (enumeration oracle closed).
- **FAILURES**: `400` invalid email; `429` rate limit; `500` only on malformed request.
- **RATE LIMIT**: 3 / min per IP (last XFF entry). **IDEMPOTENCY**: last-token-wins replacement.

### `POST /api/auth/reset-password`
- **AUTH**: public; IP rate limit.
- **INPUT**: `{ token, password }`.
- **SERVER VALIDATION**: `validatePassword(password)`; token hashed SHA-256 and consumed atomically (`consumeResetToken` — single use, expires 1 h).
- **OWNER CHECK**: token → email record.
- **DB/R2 EFFECT**: deletes/consumes `reset_tokens` row; updates `users.password_hash` (hashed by `updateUserPassword`).
- **SUCCESS**: `200 { ok: true }`.
- **FAILURES**: `400` missing fields / weak password / invalid-or-expired token / user gone; `500` malformed request.
- **RATE LIMIT**: 5 / min per IP. **IDEMPOTENCY**: token is single-use — replay returns `400`.

---

## 2. Payments (Cashfree)

### `POST /api/cashfree/order`
- **AUTH**: session (middleware + `auth()`).
- **INPUT**: `{ plan, currency?, country?, name, email, phone }`. Valid plans: `creator_monthly`, `creator_yearly` (`free` explicitly rejected `400`).
- **SERVER VALIDATION**: plan whitelist; email regex (≤254); phone 8–15 digits after sanitising; name ≤200 stripped of `<>\"'&`; price **always** recomputed server-side from geo headers (`x-vercel-ip-country` / `cf-ipcountry`) — client currency/country are dev-only fallbacks; `CASHFREE_ENV` must be a literal `sandbox`/`production` and must match `NEXT_PUBLIC_CASHFREE_ENV` (else `503`, fail closed).
- **OWNER CHECK**: active-creator check by session id **or** session email (`409` if already an active Creator plan).
- **DB/R2 EFFECT**: writes `pending_orders` (amount/currency stored from server pricing); may insert a stub `users` row for OAuth identities (FK satisfaction); last-resort insert disables FK pragma for that one statement (documented as "do not copy" in findings).
- **SUCCESS**: `200 { orderId, paymentSessionId, env }`.
- **FAILURES**: `400` invalid plan/fields/phone; `401` no session; `409` active plan already exists **or** an earlier checkout still payable (probed against Cashfree's authoritative state; probe failure → `503` fail-closed); `503` gateway unconfigured / env invalid / env mismatch; `429` rate limit; `500` Cashfree API error (phone/Cashfree-400 surfaced as `400`).
- **RATE LIMIT**: 5 / min per IP (own `globalThis` map). **IDEMPOTENCY**: one payable order at a time per identity (Phase 2.6); terminal-failed prior order releases the block.

### `POST /api/cashfree/verify`
- **AUTH**: session. Query param `?order_id=`.
- **INPUT**: none in body.
- **SERVER VALIDATION**: `order_id` present (≤200); order must exist and belong to the caller (by user id **or** matching email) — foreign orders answer `404` (same shape as unknown, Phase 2.10); Cashfree env must be usable.
- **OWNER CHECK**: `findPendingOrder` + owner email comparison.
- **DB/R2 EFFECT**: on `PAID`: atomically claims the order (`tryClaimWebhookOrder`), writes plan + expiry (`fulfillPaidOrder`), releases nothing on success (claim is deliberately kept), sends receipt once. On failure path: releases claim so a retry can proceed.
- **SUCCESS**: `200 { status: 'activated' }` | `{ status: 'pending', orderStatus }` | `{ status: 'failed', orderStatus }` (terminal Cashfree failure — client stops polling).
- **FAILURES**: `400` fulfilment rejected (e.g. `active_plan_exists`); `401`; `404` unknown/foreign order; `429`; `503` unconfigured/invalid env; `500` verify failed.
- **RATE LIMIT**: 30 / min per user (above the client's 15-poll loop).
- **IDEMPOTENCY**: atomic claim; an already-fulfilled order short-circuits to `activated` and still sends the receipt once. Claim is **not** released after a successful plan write (prevents double fulfilment on Cashfree retries).

### `POST /api/cashfree/webhook`
- **AUTH**: **public route** — secured by signature, not session.
- **INPUT**: raw body + headers `x-webhook-signature`, `x-webhook-timestamp`.
- **SERVER VALIDATION**: HMAC (`CASHFREE_SECRET_KEY` is also the webhook-signing key — Cashfree publishes no separate webhook secret) over `timestamp + payload`, `crypto.timingSafeEqual` (length-checked first); missing/invalid → `400` (bad timestamp and bad signature are answered identically — no oracle).
- **OWNER CHECK**: `order_id` must exist in `pending_orders` (`404` otherwise).
- **DB/R2 EFFECT**: on terminal `PAID`: claims order, activates plan, marks `processed_webhooks` for replay protection, re-verifies amount/currency against the stored `pending_orders` row before activation. Non-terminal events are acknowledged `200 {status:'ok'}` **without** being marked processed.
- **SUCCESS**: `200 { status: 'ok' }`.
- **FAILURES**: `400` missing headers / invalid signature / missing order_id; `404` unknown order; `503` not configured (Retry-After 60); `500` unexpected.
- **RATE LIMIT**: none (signature-gated; Cashfree's retry cadence applies).
- **IDEMPOTENCY**: `processed_webhooks` dedupe — a replayed paid event is acknowledged but never re-activates.

---

## 3. Export jobs (create / progress / poll / cleanup)

### `POST /api/export-jobs`
- **AUTH**: session.
- **INPUT**: `{ config: { platformId, outputWidth, outputHeight } }`.
- **SERVER VALIDATION**: platform must be in `LAUNCH_PLATFORM_PRESETS` (`custom` rejected `400` — no preset, no authoritative dimensions); dimensions must be **exactly** `clampResolution(preset, plan.maxResolution)` — a mismatch is `400`, never re-clamped silently; numeric range 1–7680 × 1–4320.
- **OWNER CHECK**: session user re-read from DB; `isPlanActive` (expired → `403`).
- **DB/R2 EFFECT**: inserts `export_jobs` row (`pending`, `configJson` = server-validated config); `ensureUserStatsRow` first.
- **SUCCESS**: `201 { jobId }`.
- **FAILURES**: `400` missing/invalid config, unknown platform, dimension mismatch; `401`; `403` plan expired / `canExport` false / non-YouTube platform on Free (`This format requires the Creator plan`); `429` rate limit **or** ≥3 active concurrent jobs; `500`.
- **RATE LIMIT**: 30 / h per user. Concurrency: max 3 active jobs (429).
- **IDEMPOTENCY**: creates a new job per call (client drives reuse via `jobId` on presigned-put).

### `PATCH /api/export-jobs/[id]`
- **AUTH**: session. **Owner**: `findExportJobByIdAndUser` → `404` if foreign.
- **INPUT**: `{ status?, progress?, errorMessage? }` — **only these three fields**; result fields (`resultR2Key`/`resultExportId`/`resultFileSize`) are ignored by construction.
- **SERVER VALIDATION**: transition map — `pending → encoding|failed`, `encoding → uploading|failed`, `uploading → failed`; `completed` deliberately absent (server-only). Same-status writes are progress updates (always allowed). `progress` must be a number 0–100. `errorMessage` truncated to 500 chars, HTML tags stripped.
- **DB/R2 EFFECT**: `updateExportJobStatus` on `export_jobs` (progress/error columns only).
- **SUCCESS**: `200 { ok: true }`.
- **FAILURES**: `400` invalid transition / bad progress; `401`; `404`; `500`.
- **RATE LIMIT**: none (read-mostly progress writes). **IDEMPOTENCY**: same-state writes idempotent; terminal states have no outgoing edges.

### `GET /api/export-jobs/[id]/status`
- **AUTH**: session; owner-scoped `404`.
- **INPUT**: path param. **SERVER VALIDATION**: none beyond ownership.
- **DB/R2 EFFECT**: read-only `export_jobs`.
- **SUCCESS**: `200 { id, status, progress, resultR2Key, resultExportId, resultFileSize, errorMessage, createdAt, startedAt, completedAt }`.
- **FAILURES**: `401`, `404`, `500`. **RATE LIMIT**: none. **IDEMPOTENCY**: read-only.

### `GET|POST /api/export-jobs/cleanup`
- **AUTH**: **public route** — secret-gated. Header `x-cleanup-secret` **or** `Authorization: Bearer` (Vercel cron sends `$CRON_SECRET`). Compared with `CLEANUP_SECRET` using `crypto.timingSafeEqual` (length-checked). Missing secret or missing env var → `401` (fail closed).
- **INPUT**: none.
- **SERVER VALIDATION**: constant-time secret compare only.
- **DB/R2 EFFECT**: lists jobs older than 30 days (excluding completed jobs and any key an `exports` row still references), deletes their R2 staging objects (best-effort), then deletes the `export_jobs` rows. `exports.job_id` is `ON DELETE SET NULL` — completed library entries survive.
- **SUCCESS**: `200 { deleted, r2Cleaned }`.
- **FAILURES**: `401` bad/missing secret; `500` sweep failure.
- **RATE LIMIT**: none (secret-gated). **IDEMPOTENCY**: idempotent sweep — re-running finds nothing.
- **SCHEDULE**: `vercel.json` cron `0 2 * * *` (02:00 UTC daily) → `GET`.

---

## 4. Export artifacts (upload → complete)

### `POST /api/exports/presigned-put`
- **AUTH**: session. **Free is rejected before any storage logic** — `403 "Free plan uses local export"` (a plan property, resolved before R2 configuration checks).
- **INPUT**: `{ platformId, duration?, crop?, hasAudio?, jobId? }`.
- **SERVER VALIDATION**: platform in launch matrix (`custom` → `400`); `duration` ≤ plan `maxDurationSeconds` (Free: 600 s) and ≤ `MAX_EXPORT_DURATION_SECONDS` (claim-based UX pre-check; the **authoritative** check is server-verified byte size in `complete`); crop requires `canCrop` (Free → `403`); dimensions = clamped preset (never client input); optional `jobId` must be an owned, non-terminal job (`409` otherwise); `hasAudio` normalised into the job config as the encoder's ground-truth claim.
- **OWNER CHECK**: session user from DB; existing job by id+user.
- **DB/R2 EFFECT**: creates or reuses `export_jobs` row; writes `staging_r2_key` atomically (`setExportJobStagingKey` → `409` if lost the race).
- **SUCCESS**: `200 { jobId, key, uploadUrl, expiresIn: 900, outputWidth, outputHeight }` — presigned PUT, content-type `video/mp4`, 15-minute TTL.
- **FAILURES**: `400` missing/invalid platform or job; `401`; `403` plan expired / upgrade / Free / duration / crop / resolution; `409` job not available (terminal, or staging key race); `429` rate limit or ≥3 concurrent; `503` R2 unconfigured; `500`.
- **RATE LIMIT**: 10 / h per user (throttled **before** DB lookup on purpose).
- **IDEMPOTENCY**: `staging_r2_key` write is atomic single-key — second concurrent issuance for the same job loses → `409`.

### `POST /api/export-upload` (legacy/multipart path)
- **AUTH**: session. **Free rejected first**: `403 "Free plan uses local export"` (route line 48–50, before quota logic).
- **INPUT**: `multipart/form-data` with `file`, `platformId`, `jobId?`.
- **SERVER VALIDATION**: `file.size > MAX_EXPORT_SIZE_BYTES` → `413`; empty → `400`; content-type must be exactly `video/mp4` → else `400`; platform must be in launch matrix; free-plan/platform/duration/crop/resolution checks mirror presigned-put; local constant `MAX_EXPORT_SIZE_MB = 200` governs this route's size message.
- **OWNER CHECK**: session user from DB; optional owned job.
- **DB/R2 EFFECT**: uploads final object to `exports/{userId}/{uuid}.mp4` (`uploadRecording`); increments upload/storage counters **after** verification; creates `exports` row; completes job if given.
- **SUCCESS**: `200 { exportId, r2Key, … }` (see route for full body).
- **FAILURES**: `400` no file / empty / bad type / invalid platform; `401`; `403` Free/plan/crop/platform/duration; `413` too large; `429` rate limit; `503` R2; `500`.
- **RATE LIMIT**: 20 / h per user. **IDEMPOTENCY**: new UUID key per call (no replay protection beyond rate limit).

### `POST /api/exports/complete` — the Phase 3 authority
- **AUTH**: session; owner-scoped job.
- **INPUT**: `{ jobId, key, fileSize, mimeType, platformId, outputWidth, outputHeight, duration?, hasAudio? }` — all client claims.
- **SERVER VALIDATION** (in execution order):
  1. Required fields; `fileSize > MAX_EXPORT_SIZE_BYTES` → `413`; `mimeType` (if present) must be `video/mp4` → `400`.
  2. Job exists and is owned (`400` invalid job).
  3. **Replay echo**: a completed job whose staging key matches returns `200 { exportId, r2Key }` — but only after verifying the referenced `exports` row is really owned by this user (tampered/legacy `resultExportId` → `409`). Completed-without-match → `409`; failed → `409`.
  4. **Key binding**: `key` must equal the job's `staging_r2_key` (`403 Key mismatch`), except a legacy adoption path (no staging key yet, `resultR2Key === key`, key under own `exports/{uid}/` prefix) which adopts it atomically. Key must start with `staging/{uid}/` or `exports/{uid}/` (`403 Invalid key`) — cross-user keys never pass.
  5. Platform must be in the launch matrix; must not be locked for the plan (Free → `403`); must equal the **job config's** platform (`400 Platform mismatch`); `outputWidth/Height` must equal `clampResolution(preset, plan)` exactly (`400`).
  6. **Server-side object inspection** (`headObject`): object must exist with size > 0 (`400`); size ≤ `MAX_EXPORT_SIZE_BYTES` else staging object **deleted** and `413`; client `fileSize` disagreement (>1 KiB) only logged — server size wins; content-type must be `video/mp4`/`application/mp4` else staging deleted + `400`; missing eTag → `503`.
  7. **Phase 3 artifact verification** — `collectMp4Metadata` walks the stored object with **bounded ranged reads pinned to the eTag** (16 KiB head, 8-byte box headers, moov box; mdat payload up to 2 GiB is **never** buffered), then `verifyExportArtifact` checks structure (`ftyp`/`moov`/`mdat`/video track), dimensions, duration (tolerance vs claimed/job duration), audio expectation (`hasAudio` claim from the encoder's probe), and size. Failure → staging object deleted, `400` with a described failure (job stays `uploading`, so corrected re-upload + complete can retry). Reader/IO errors are **not** caught here: they surface as retryable `500` with the staging object intact (they are not evidence against the artifact).
  8. **Finalization claim**: `claimExportJobFinalization` (atomic token). Losing the race → `409` unless the winner already completed (then echo).
  9. **R2 finalize**: copy staging → `exports/{uid}/{jobId}.mp4`, re-`headObject` the final object — size and content-type must match exactly, else final object deleted, claim released, `502`.
  10. **Quotas (all atomic, all reverted on any later failure)**: daily recording allowance (Free 600 s/day, charge = `max(client claim, floor from verified bytes)` at a generous ceiling bitrate — `403` when exhausted, objects deleted); monthly export count (`403` when exceeded); upload count + storage bytes (`403` with reason). Creator: allowances are `null` → no charge.
  11. **`atomicFinalizeExport`**: writes `exports` row + job `completed` + result fields in one transaction guarded by the token. `claim_lost` → quotas reverted, final object deleted, `409` (or replay echo).
  12. Staging object deleted (best-effort; staging key retained on the job so cleanup can retry).
- **DB/R2 EFFECT**: `export_jobs` (claim → completed + result columns), `exports` insert, `user_stats`/`daily_recording_seconds`/`monthly_export_counts` counters, R2 copy + deletes. Every failure path reverts the quotas it consumed and deletes created objects.
- **SUCCESS**: `200 { exportId, r2Key }`.
- **FAILURES**: `400` missing/invalid fields, invalid job/platform/dimensions, key issues are `403`, artifact verification failure, object missing/empty, bad content-type; `401`; `403` plan/campaign/quota/key; `409` concurrent finalization / already completed / failed / replay-without-owned-row; `413` oversize (client claim or verified object); `429` rate limit; `502` finalized-object verification failed; `503` R2/eTag; `500` IO (staging kept — retryable).
- **RATE LIMIT**: 30 / h per user.
- **IDEMPOTENCY**: full replay echo for completed jobs (verified ownership), atomic finalization token, atomic quota reverts — a duplicate completion is either a harmless echo or a `409`, never a double charge. **The server is the final authority: it verifies the actual bytes before any claim, quota, or DB write exists.**

---

## 5. Exports (library records)

### `GET /api/exports`
- **AUTH**: session. **INPUT**: none. **SERVER VALIDATION**: none beyond session.
- **DB/R2 EFFECT**: `SELECT … FROM exports WHERE user_id = ? ORDER BY created_at DESC LIMIT 100` (read-only).
- **SUCCESS**: `200 { exports: [ { id, r2Key, platform, outputWidth, outputHeight, fileSize, mimeType, status, createdAt, jobId } ] }`.
- **FAILURES**: `401`, `500`. **RATE LIMIT**: none. **IDEMPOTENCY**: read-only.

### `GET /api/exports/[id]`
- **AUTH**: session; owner-scoped lookup → `404`.
- **INPUT**: path param. **SERVER VALIDATION**: none.
- **DB/R2 EFFECT**: read-only. **SUCCESS**: `200 { export }`.
- **FAILURES**: `401`, `404`, `500`. **RATE LIMIT**: none. **IDEMPOTENCY**: read-only.

### `DELETE /api/exports/[id]`
- **AUTH**: session; owner-scoped `404`.
- **INPUT**: path param.
- **SERVER VALIDATION**: R2 delete skipped for `local/` keys (no object exists); R2 failure is logged and non-fatal — the DB row is still removed (documented behaviour, see findings on deletion ordering).
- **DB/R2 EFFECT**: deletes R2 object (best-effort) → `DELETE FROM exports WHERE id = ? AND user_id = ?` → decrements `user_stats.storage_bytes` (floored at 0).
- **SUCCESS**: `200 { success: true }`.
- **FAILURES**: `401`, `404`, `429`, `500`. **RATE LIMIT**: 30 / h per user. **IDEMPOTENCY**: second delete → `404` (row gone).

### `GET /api/exports/[id]/preview`
- **AUTH**: session; owner-scoped `404`.
- **INPUT**: path param.
- **SERVER VALIDATION**: plan must be active (`403`); export must be `completed` (`404`); `local/` keys → `400 "Local export, no preview"`; R2 configured (`503`).
- **DB/R2 EFFECT**: read-only; returns a signed GET URL (TTL 3600 s).
- **SUCCESS**: `200 { url, expiresIn: 3600 }`.
- **FAILURES**: `400` local export; `401`; `403` expired plan; `404` missing/not ready; `503` R2; `500`.
- **RATE LIMIT**: none. **IDEMPOTENCY**: read-only.

### `POST /api/exports/consume-quota`
- **AUTH**: session.
- **INPUT**: none.
- **SERVER VALIDATION**: plan active; `canExport`; `maxExportsPerMonth === null` (Creator, and currently Free too — both plans are `null`) short-circuits `{ allowed: true, count: null, unlimited: true }` without touching the ledger.
- **DB/R2 EFFECT**: `atomicTryConsumeMonthlyExport` only when a plan has a monthly cap.
- **SUCCESS**: `200 { allowed: true, count }` or `{ allowed: true, count: null, unlimited: true }`.
- **FAILURES**: `403` plan expired / upgrade / limit reached; `401`; `500`.
- **RATE LIMIT**: none. **IDEMPOTENCY**: atomic conditional increment — a denied call consumes nothing.

### `GET /api/download`
- **AUTH**: session.
- **INPUT**: query `exportId`.
- **SERVER VALIDATION**: `exportId` without `..`/`%2e%2e` (`400`); plan active (`403`); `canDownload` (`403`); export exists, owned (`404`), and `completed` (`404`); key must not be `local/` and must be under the caller's own `exports/{uid}/` prefix if it is an `exports/` key — otherwise `404` shaped exactly like a missing export (no cross-user existence leak); R2 configured (`503`).
- **DB/R2 EFFECT**: `ensureUserStatsRow`; **signs the URL first** (Phase 2.11 — an R2 failure must not burn a limited-plan credit; the URL is discarded if a later check denies), then `atomicIncrementDownloadCount` against `maxDownloads` (`403` when the limit is hit — no credit consumed), else best-effort counter increment for unlimited plans.
- **SUCCESS**: `200 { url, expiresIn }` (`R2_SIGNED_URL_TTL_SECONDS`, default 3600).
- **FAILURES**: `400` bad param; `401` no session/user; `403` expired plan / no download right / limit reached; `404` missing/completed/local/foreign key; `429`; `503` R2; `500`.
- **RATE LIMIT**: 30 / h per user. **IDEMPOTENCY**: read-ish; each successful call consumes at most one credit.

> Ordering nuance (documented here rather than rewriting `AUTHORIZATION.md`'s
> ladder): the implementation signs **before** consuming the quota credit, while
> the AUTHORIZATION.md ladder reads "quota consume → signed URL". The security
> property is identical — an unsigned URL is never returned on denial — but the
> sequence is sign → consume → return.

---

## 6. Account & platform metadata

### `GET /api/user/stats`
- **AUTH**: session. **INPUT**: none.
- **SERVER VALIDATION**: plan read from DB (never the JWT); expired paid plan is reported as `free` for this response.
- **DB/R2 EFFECT**: reads `users` + `user_stats`; read-only.
- **SUCCESS**: `200 { plan, downloads: { used, limit }, uploads: { used, limit }, storage: { usedBytes, limitMB }, entitlements: { canExport, canDownload, canBatchExport, maxResolution, maxDurationSeconds } }`. Every `limit`/`limitMB` field is nullable: `null` means *no quota applies*, not "unlimited uploads". Per F-01 (owner decision 2026-10-07) Free is local/device-only, so `uploads.limit` and `storage.limitMB` are `null` for every customer plan — the stale `3 files / 500 MB` values must never surface again — and `downloads.limit` is `null` because downloads are unlimited on all plans.
- **FAILURES**: `401`, `500`. **RATE LIMIT**: none. **IDEMPOTENCY**: read-only.

### `DELETE /api/user/delete`
- **AUTH**: session (the password gate lives in the client flow, **not** this route — noted as a trust-boundary fact in findings).
- **INPUT**: none.
- **SERVER VALIDATION**: none beyond session + rate limit.
- **DB/R2 EFFECT** (in order): collect R2 keys from `exports` rows (excluding `local/`) **plus** an R2 prefix listing of `exports/{uid}/` for orphans → best-effort R2 deletes (missing = success) → `DELETE` `exports`, `export_jobs`, `monthly_export_counts`, `user_stats`, `pending_orders` for the user → `recordDeletedIdentity(email, sessionVersion + 1)` tombstone — **failure here aborts with `500` and keeps the user row** (fail closed: an unrecorded deletion would leave old sessions usable) → `DELETE users`. Session cookies (`__Secure-` and bare names) cleared on success.
- **SUCCESS**: `200 { success, deletedR2Objects, userDeleted }`.
- **FAILURES**: `401`; `429`; `500` deletion failed (tombstone failure keeps the account).
- **RATE LIMIT**: 5 / h per user.
- **IDEMPOTENCY**: repeat call → `401 User not found` (row gone).
- **Not deleted** (documented in findings): objects under a `recordings/{uid}/` prefix, `reset_tokens`, `daily_recording_seconds`, `order_notifications` rows — no code path writes `recordings/` keys today (`generateRecordingKey` has no caller), so the first is currently moot; the DB rows are orphans by design of this route.

### `GET /api/recordings`
- **AUTH**: session. **INPUT**: none.
- **SERVER VALIDATION**: none. **OWNER CHECK**: prefix listing is hard-bound to `recordings/{userId}/`.
- **DB/R2 EFFECT**: R2 list only (read-only); returns `{ recordings: [] }` when R2 is unconfigured rather than erroring.
- **SUCCESS**: `200 { recordings: [ { key, size, lastModified, recordingId } ] }`.
- **FAILURES**: `401`, `500`. **RATE LIMIT**: none. **IDEMPOTENCY**: read-only.

### `POST /api/feedback`
- **AUTH**: session.
- **INPUT**: `{ text }`.
- **SERVER VALIDATION**: non-empty string; `sanitizeFeedback` neutralises `@everyone`/`@here`/mentions, strips `<>\"'` backticks, truncates to 500 chars; Discord webhook must be configured (else `503`).
- **DB/R2 EFFECT**: none in DB/R2; POSTs to `DISCORD_WEBHOOK_URL` (used **only** here).
- **SUCCESS**: `200 { ok: true }`.
- **FAILURES**: `400` missing/invalid after sanitising; `401`; `429`; `503` not configured; `500` Discord send failed.
- **RATE LIMIT**: 3 / h per user. **IDEMPOTENCY**: none (duplicates post twice; rate-limited).

### `GET /api/health`
- **AUTH**: public route; optional session adds detail.
- **INPUT**: none. **SERVER VALIDATION**: runs `ensureMigrated()` + `SELECT 1` on every probe.
- **DB/R2 EFFECT**: read-only (migration check runs per call — noted in findings as a warm-path cost).
- **SUCCESS**: `200 { status: 'healthy', timestamp, version, commit }` (commit = short `VERCEL_GIT_COMMIT_SHA`); authenticated callers additionally get `checks.database` / `checks.r2` (+ `r2_detail`).
- **FAILURES**: `503 { status: 'degraded' }` when the DB check fails.
- **RATE LIMIT**: none. **IDEMPOTENCY**: read-only.

### `POST /api/observe/client-error`
- **AUTH**: public route (middleware allowlist).
- **INPUT**: `{ kind, plan?, duration?, platform?, browser? }`.
- **SERVER VALIDATION**: `kind` must be one of `recording_failed`, `video_playback_failed`, `export_encoder_failed`, `export_failed` (`400` otherwise); every field is truncated server-side; **never logs video blobs, scripts, or URLs** (explicit comment + shape).
- **DB/R2 EFFECT**: structured `logger.warn('client_error', …)` line only.
- **SUCCESS**: `200 { ok: true }`. **FAILURES**: `400` bad kind; `500`.
- **RATE LIMIT**: none (public, unauthenticated — recorded in findings).
- **IDEMPOTENCY**: logging only.

---

## Rate-limit summary

| Route | Limit | Key |
| ----- | ----- | --- |
| `auth/[...nextauth]` POST | 10 / 15 min | IP (last XFF) |
| `auth/forgot-password` | 3 / min | IP (last XFF) |
| `auth/reset-password` | 5 / min | IP (last XFF) |
| `cashfree/order` | 5 / min | IP (own map) |
| `cashfree/verify` | 30 / min | user |
| `download` | 30 / h | user |
| `export-jobs` POST | 30 / h (+3 concurrent) | user |
| `exports/complete` | 30 / h | user |
| `exports/presigned-put` | 10 / h | user |
| `export-upload` | 20 / h | user |
| `exports/[id]` DELETE | 30 / h | user |
| `user/delete` | 5 / h | user |
| `feedback` | 3 / h | user |
| All other routes | — | see per-route notes |

## Idempotency model (summary)

| Mechanism | Where | Guarantee |
| --------- | ----- | --------- |
| Replay echo | `exports/complete` | Duplicate completion returns the same `exportId/r2Key` after verifying the row is owned; never double-charges. |
| Finalization token | `exports/complete` | Atomic claim; the loser gets `409` (or the echo), quotas reverted. |
| Staging-key race | `presigned-put`, legacy adoption in `complete` | Atomic single-key write; loser gets `409`. |
| Single-use tokens | `reset-password` | Consumed atomically; replay → `400`. |
| Webhook claim | `cashfree/webhook`, `cashfree/verify` | `processed_webhooks` dedupe + `tryClaimWebhookOrder`; the claim is not released after a successful plan write. |
| Receipt once | `cashfree/verify` | `sendOrderReceiptOnce` after activation. |
| Atomic conditional counters | download/upload/monthly/daily quotas | A denied consume consumes nothing; every later failure in `complete` reverts what was consumed. |
