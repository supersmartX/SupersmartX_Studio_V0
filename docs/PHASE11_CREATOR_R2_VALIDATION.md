# Phase 11 — Creator and R2 Delivery Validation

Validation date: 2026-10-27. Host: Windows 10.0.26300 (x64). App: local Next.js dev server at `http://localhost:3000`.

Method: (a) the application's own R2 configuration validator and presigner were executed against this repository's real `.env.local`, then against a synthetic well-formed configuration; (b) every Creator/R2 HTTP endpoint was probed over real HTTP against the running dev server; (c) the Creator upload → complete → download code path was audited against its stated invariants. No R2 network operation was performed, no account was created, no database was written, and no application code was changed in Phase 11.

## Executive Result

BLOCKED — cloud delivery is NOT validated.

- The Creator/R2 delivery cycle could not be executed. Three credentials are empty, there is no Creator session, and creating one would require writing to the shared production Supabase database. No presigned PUT, `complete`, finalize-copy, signed download, or staging cleanup has ever been run against a real bucket.
- What *could* be executed is clean: all 11 Creator/R2 endpoints reject unauthenticated callers with 401 before any existence lookup; the cleanup route fails closed; the config validator names the exact missing variable; and the presigner emits a correctly shaped, key-pinned, path-style URL with a 900 s expiry.
- One arithmetic risk was found in the upload path (900 s URL lifetime vs a 2 GiB artifact cap). It is demonstrated from repository constants, not reproduced against R2, and was not changed.
- The 1080p capture-profile product decision is below: **KEEP** the current plan-independent 1080p capture.
- No reproducible defect was found in Phase 11.

This result means the Creator/R2 path is **not** to be described as validated, production-ready, or frozen. Only the recording engine (Phase 9) and the local/Free export architecture (Phase 10) have evidence behind them.

## Prerequisites

| Requirement | State | Evidence |
|---|---|---|
| Creator test account or session | ABSENT | No credentials available. Creating one would insert a user with a paid plan into the shared Supabase database, which Phase 9/10 constraints forbid without explicit authorization. |
| `R2_ACCOUNT_ID` | EMPTY | App validator returns `R2_ACCOUNT_ID is not set` |
| `R2_ACCESS_KEY_ID` | EMPTY | Validator returns `R2_ACCESS_KEY_ID is not set` once an account ID is supplied |
| `R2_SECRET_ACCESS_KEY` | EMPTY | Validator returns `R2_SECRET_ACCESS_KEY is not set` once both prior values are supplied |
| `R2_BUCKET_NAME` | SET | Validator accepts the configured bucket name |
| `R2_ENDPOINT` | SET but UNUSED | No reference anywhere in `src/`. Its presence does not configure storage and can mislead an operator into believing storage is wired. |
| Throwaway PostgreSQL | ABSENT | `DATABASE_URL` points at a Supabase pooler. Suites guarded by `describeDb` skip themselves without a throwaway database. |
| Local S3-compatible server | ABSENT | Docker CLI is installed; the daemon is not running and Docker Desktop is not installed at its default path. `getR2Client()` also hardcodes `https://<account>.r2.cloudflarestorage.com`, so an endpoint override does not exist. |

Consequence: the database-backed Creator completion suites (`export-complete-security`, `postgres-semantics.integration`, `monthly-quota`, `export-jobs-db`, `export-failure-finalize`, `export-job-cleanup`, and the other `describeDb` files) are **skipped**, not passed. The full-suite figure of ~302 skipped tests is mostly this gap.

## Gate Matrix (real HTTP)

All requests were unauthenticated. Identity is checked before any object or row lookup in every case, so a nonexistent identifier is indistinguishable from a real one to an unauthenticated caller.

| Endpoint | Method | Status | Body |
|---|---|---|---|
| `/api/exports/presigned-put` | POST | 401 | `{"error":"Unauthorized"}` |
| `/api/exports/complete` | POST | 401 | `{"error":"Unauthorized"}` |
| `/api/export-jobs` | POST | 401 | `{"error":"Unauthorized"}` |
| `/api/export-jobs/{id}` | GET | 401 | `{"error":"Unauthorized"}` |
| `/api/export-jobs/{id}` | PATCH | 401 | `{"error":"Unauthorized"}` |
| `/api/export-jobs/{id}/status` | GET | 401 | `{"error":"Unauthorized"}` |
| `/api/exports` | GET | 401 | `{"error":"Unauthorized"}` |
| `/api/exports/{id}` | GET | 401 | `{"error":"Unauthorized"}` |
| `/api/exports/{id}` | DELETE | 401 | `{"error":"Unauthorized"}` |
| `/api/exports/{id}/preview` | GET | 401 | `{"error":"Unauthorized"}` |
| `/api/download?exportId=…` | GET | 401 | `{"error":"Unauthorized"}` |
| `/api/export-jobs/cleanup` (no secret) | GET | 401 | `{"error":"Unauthorized"}` |
| `/api/export-jobs/cleanup` (wrong secret) | GET | 401 | `{"error":"Unauthorized"}` |

The cleanup route fails closed when `CLEANUP_SECRET` is unset or the presented secret is wrong, and compares in constant time with a length pre-check.

What the matrix does not prove: any behaviour after authentication. It confirms the outer boundary only.

## Configuration Proof

The repository's real `.env.local` was loaded and the production functions were executed directly.

| Probe | Result |
|---|---|
| `getR2ConfigurationError()` on the real environment | `R2_ACCOUNT_ID is not set` |
| `isR2Configured()` on the real environment | `false` |
| Supply a well-formed 32-hex account ID | `R2_ACCESS_KEY_ID is not set` |
| Supply an access key ID | `R2_SECRET_ACCESS_KEY is not set` |
| Supply a secret access key | `null` — configured |

The validator is not itself a blocker: each variable is reported in order, and a well-formed set of values resolves to "configured".

The presigner was then executed with the synthetic configuration. The resulting URL had these properties:

| Property | Observed |
|---|---|
| Scheme / host | `https://<account>.r2.cloudflarestorage.com` |
| Addressing style | Path-style — the bucket is the first path segment, not a host prefix |
| Object key | Exactly the server-issued staging key `staging/{userId}/{jobId}-staging.mp4` |
| Expiry | `X-Amz-Expires=900` |
| Signed headers | `host` only |
| Signature | Present (`X-Amz-Signature`) |

This confirms the regression that previously produced a non-existent virtual-hosted host is still fixed, and that the URL the browser receives is pinned to one staging object. It does **not** prove that Cloudflare accepts the signature, that the bucket exists, that bucket CORS permits a browser `PUT`, or that the credentials carry write permission. Those require the real bucket.

`X-Amz-SignedHeaders=host` also means `Content-Type` is not signature-bound: a holder of the URL can send any content type. This is not a defect because `complete` re-reads the stored object's content type server-side and deletes the staging object when it is not `video/mp4` / `application/mp4`, but the enforcement point is post-upload, not at the edge.

## Creator Path Audit

Static audit of the upload → complete → deliver path. "Enforced" means the invariant is structurally guaranteed by code that would run regardless of client behaviour.

| Invariant | Status | Mechanism |
|---|---|---|
| Only the owning user can reach a job | Enforced | Every job lookup is scoped by `userId` |
| Client cannot author completion | Enforced | PATCH transition map has no `completed` target and result fields are never persisted from the body |
| Client cannot repoint the upload | Enforced | The staging key is issued and pinned server-side; `complete` rejects any key that differs |
| Staging objects cannot become final objects | Enforced | `complete` requires a `staging/{userId}/` prefix; `download`/`preview` refuse `staging/` and `local/` |
| Cross-user delivery | Enforced | Signing requires `exports/{userId}/` with a trailing slash, so a user-id prefix cannot match another user's namespace |
| Duplicate completion | Enforced | Claim token plus a 30-minute finalization lease; a replay returns the owned export instead of finalizing twice |
| Declared size is not trusted | Enforced | `HeadObject` size wins; a client mismatch only logs |
| Artifact must parse before quota is spent | Enforced | MP4 metadata is collected from ETag-pinned ranged reads before any claim or quota write |
| Failed finalize does not consume quota | Enforced | Every failure branch reverts recording seconds, monthly count and upload count |
| Plan is re-checked at completion | Enforced | `isPlanActive` and fresh entitlements are read at completion, not taken from the job row |
| Free cannot obtain a staging key | Enforced | `presigned-put` returns 403 for `free` before the storage-configuration check; without a staging key, `complete` cannot pass its key pin |
| Downgrade mid-job | THEORETICAL | A Creator who obtains a staging key, uploads, then downgrades before `complete` is not gated on `free` in `complete`. For a 720p-class preset whose clamped dimensions still match, the write would proceed. Requires R2 plus a real plan change; not reproduced, low impact, and arguably correct since the upload began while Creator. |
| Upload retry after signature expiry | MISSING | `export-upload.ts` makes one attempt per stage. A 403 from an expired signature surfaces as "storage rejected the upload (status 403)" with no re-sign and no retry. |

## Upload Window Risk

The upload URL expires after 900 s and the artifact cap is 2048 MiB. Both are repository constants, so the consequence is arithmetic rather than speculative.

| Uplink | Time to upload 2 GiB | Result |
|---|---:|---|
| 5 Mbps | 3,436 s | URL expires at 900 s |
| 10 Mbps | 1,718 s | URL expires at 900 s |
| 20 Mbps | 859 s | completes |
| 50 Mbps | 344 s | completes |

| Uplink | Bytes uploadable within 900 s |
|---|---:|
| 5 Mbps | 536 MiB |
| 10 Mbps | 1,073 MiB |
| 20 Mbps | 2,146 MiB |

- A 2 GiB export needs **≥ 19.1 Mbps** sustained upload to finish inside one presigned URL.
- A 529 s (8 min 49 s) 1080p export is ~643 MiB at the encoder's nominal 10.2 Mbps and needs **≥ 6.0 Mbps**.
- Below 6 Mbps, that ordinary-length export fails at roughly the 15-minute mark, after the encode has already completed. The failure is not retried, so recovery means re-encoding the whole export.

Status: RISK — demonstrated from constants, not reproduced against R2. Not changed, per the standing rule against optimizing undemonstrated defects. When R2 is unblocked, the first large upload should be run on a throttled connection to confirm the behaviour, and the fix (re-presign on 403, or a longer TTL) chosen from that evidence.

## 1080p Capture Profile Decision

Question: Free delivers at most 1280×720 and is local-only, yet recording always selects the highest profile the device supports — `1080p30` (1920×1080, 8 Mbps) or `1080p-low-fps` (1920×1080, 24 fps) — with no plan input. Should capture be lowered for Free?

Evidence:

| Measurement | Value | Source |
|---|---|---|
| Free export cap | 1280×720 | `FREE_RESOLUTION` |
| Capture profile | 1920×1080, 8 Mbps, plan-independent | `getBestRecordingProfile` |
| Delivered encoded cadence, Chromium | 16.55–16.59 fps (requested 30) | Phase 9, parsed container |
| Delivered encoded cadence, Edge | ≈9.96 fps | Phase 9 |
| 529 s master size | 264,287,337 B (≈4.0 Mbps actual) | Phase 9 / Phase 10 |
| 720p export of that master | 352,733,553 B, 339 s encode (0.64× realtime) | Phase 10 |
| Max Free take (600 s) at measured rate | ≈286 MB in IndexedDB | Derived |

Decision: **KEEP 1080p capture for all plans.**

Reasons:

1. The recorded master is the only copy. It is what makes a later Creator upgrade able to deliver 1080p from footage already recorded. Capturing at 720p for Free would permanently destroy that path and contradict the stated Creator benefit of "1080p with no watermark."
2. The Free/Creator difference is already enforced at the delivery boundary by `clampResolution`, which is the correct place for a paid difference. Capture is not a delivery decision.
3. No measurement supports changing it. There is no measured 720p capture cadence, no measured export-time improvement from a smaller master, and no measured quality comparison between native 720p capture and 1080p downscaled to 720p. The only measured limitation — 16.5 fps at 1080p — is a hardware/capture-path property that Phase 9 already recorded and that reducing resolution is not proven to fix.
4. Changing the profile would modify the recording engine that Phase 9 froze, on the strength of an unmeasured benefit.

Revisit only if one of these is measured: a consistent Free-device storage failure caused by 1080p masters; an export-time reduction large enough to matter from capturing at 720p; or a demonstrated cadence improvement at 720p on the same hardware. Any of those is a new phase with a demonstrated defect, not a Phase 11 change.

## Test and Type State

Re-run after Phase 11 to confirm the codebase is at baseline: 58 test files passed, 24 skipped; 670 tests passed, 302 skipped (1,164 total, 27.4 s). This is identical to the Phase 10 run. The 24 skipped files are the `describeDb` suites, which cannot run without a throwaway PostgreSQL database. `npx tsc --noEmit` is clean.

## Reproducible Defects

None. No defect was reproduced in Phase 11, and no code was changed. The Phase 10 Library refresh defect remains fixed and covered by a regression test.

## Remaining Limitations

- No presigned PUT was ever sent to R2; bucket existence, CORS, write permission, and signature acceptance are unverified.
- No `complete` → finalize-copy → signed-download cycle was executed against a real object.
- No 2 GiB artifact was produced or uploaded; the size-cap rejection paths are covered only by unit and (skipped) database tests.
- No Creator session exists, so every post-authentication behaviour — quota consumption, concurrency cap, monthly count, download counter, library listing — is unverified in this environment.
- Database-backed export suites are skipped; "green" in the full suite excludes them.
- `complete`'s downgrade edge case is reasoned, not reproduced.
- The upload-window risk is arithmetic, not observed.
- No perceptual or quality comparison between 720p capture and downscaled 1080p capture was performed.

## What Would Unblock Phase 11

1. A Creator test session, or authorization to create one test account in the database.
2. `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` for a dedicated test bucket, plus authorization to write to it.
3. Bucket CORS allowing `PUT` from `http://localhost:3000`.
4. Optional but strongly recommended: a throwaway PostgreSQL database so the skipped completion suites actually run.

With those, the executable sequence is: presigned-put → PUT a real MP4 → complete → confirm staging object deleted and final object present → signed download twice (counter behaviour) → preview playback → delete → cleanup sweep.

## Addendum — live R2 validation (2026-10-27, second session)

Credentials are present in `.env.local` (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`), and the dev server was restarted so the current file is loaded (`- Environments: .env.local`). One controlled write cycle was authorised and executed against the production bucket under a synthetic namespace (`p11e2e-<stamp>`); no real user's prefix was touched, and both objects were deleted at the end.

### Checksum parameters — NOT incompatible (premise disproven)

`@aws-sdk/client-s3` 3.1116.0 defaults to `requestChecksumCalculation: WHEN_SUPPORTED`, which injects `x-amz-checksum-crc32` (CRC32 of the empty signing-time body, `AAAAAA==`) and `x-amz-sdk-checksum-algorithm` into presigned PUT URLs, and `x-amz-checksum-mode` into presigned GET URLs. Cloudflare's S3 API compatibility table marks those headers as not implemented.

A live A/B against this bucket shows the parameters are **inert in query form**, not fatal:

| Probe | Result |
|---|---|
| Presigned PUT via a default (checksum-injecting) client, 14-byte body | `200`, object stored (14 bytes, `video/mp4`) |
| Presigned GET with `x-amz-checksum-mode`, same object | `200`, 14 bytes returned |
| Presigned PUT via `WHEN_REQUIRED` client | `200` (used for the full cycle below) |

The earlier "browser PUT fails with `Header 'x-amz-checksum-crc32' … not implemented`" hypothesis does not reproduce on this bucket for presigned single-part requests. The client is configured with `requestChecksumCalculation: 'WHEN_REQUIRED'` / `responseChecksumValidation: 'WHEN_REQUIRED'` so access URLs carry no parameters the API documents as unimplemented; this is a hygiene guard, **not** a fix for an observed failure. Header-form and multipart checksum requests were not tested.

### Controlled cycle — PASS

Small real MP4 (1,060,703 bytes, 1280×720, `avc1`, 4.473 s, one audio track), uploaded server-side through the signed URL.

| Step | Result |
|---|---|
| Presigned PUT | key pinned to `staging/<user>/<job>-staging.mp4`, `X-Amz-Expires=900`, `SignedHeaders=host`, no checksum params |
| Upload (real network) | `200` in 3.1 s, ETag returned |
| Staging object | exists, 1,060,703 bytes, `video/mp4`, ETag present |
| Ranged artifact verification (the `complete` gate: ETag-pinned head probe + box walk, `verifyExportArtifact`) | `ok: true` |
| ETag precondition on copy (deliberately wrong ETag) | `PreconditionFailed: 412` — enforced by the bucket |
| Conditional copy staging → final | final object exists, same size, 1.5 s |
| Signed download #1 / #2 (300 s) | `200` both, SHA-256 identical to source, URL key-pinned |
| Decode in real Chromium | `readyState 4`, `duration 4.4727`, 1280×720, playback advanced to 0.84 s |
| Cleanup | staging deleted, final deleted, prefix sweep `leftoverObjects=0` |

No database was touched by this cycle, so quota counters, ownership rows, and the finalization lease were neither exercised nor changed.

### CORS — blocked for browser PUT from `http://localhost:3000`

| Probe | Result |
|---|---|
| `OPTIONS` preflight (`Origin: http://localhost:3000`, `Access-Control-Request-Method: PUT`, `…-Headers: content-type`) | `403`, no `Access-Control-Allow-Origin` |
| Browser `fetch` PUT from the running app origin | rejected `TypeError: Failed to fetch`; CDP capture shows the preflight 403 and no stored PUT |

One first-attempt anomaly is recorded for completeness: that attempt rejected in the browser yet a 10-byte object appeared at its probe key. A repeat with CDP capture stored nothing, and the stray object was deleted. The reproducible state is "preflight denied", and no client-side workaround exists.

Required Cloudflare configuration (bucket settings, not code):

| Field | Value |
|---|---|
| AllowedOrigins | `http://localhost:3000`, plus the deployed origin |
| AllowedMethods | `PUT`, `GET`, `HEAD` |
| AllowedHeaders | `content-type` (add anything else the client sets) |
| ExposeHeaders | `ETag` |
| MaxAgeSeconds | e.g. `3600` |

### Scope of this cycle

Proven: the real bucket accepts the app's presigned PUT, stores the object at the exact staging key, serves it back through the ETag-pinned ranged reads `complete` performs, enforces the copy precondition, serves byte-identical signed downloads, and the bytes decode as a playable 720p MP4. Cleanup leaves no residue.

Not proven: the authenticated HTTP endpoints (`/api/exports/presigned-put`, `/api/exports/complete`, `/api/download`, preview) and the quota/lease/ownership transaction inside them. Driving those needs a Creator session; none exists, registration yields a free-plan user, there is no admin plan endpoint, and creating a paid-plan row in the shared Supabase database is out of scope without explicit authorisation. Browser-side delivery additionally waits on the CORS rule above.

## FINAL ARCHITECTURE DECISION

`R2 STORAGE LAYER — VALIDATED against the production bucket (2026-10-27).`

`CREATOR/R2 DELIVERY — PARTIALLY VALIDATED: browser upload blocked by bucket CORS; authenticated endpoint chain unexercised (no Creator session).`

`1080P CAPTURE PROFILE — KEEP (no change to the frozen recording engine).`

Do not describe cloud export or Creator delivery as validated until the authenticated chain has run in a browser against a CORS-enabled bucket. The local/Free export architecture remains the only delivery path with end-to-end evidence.
