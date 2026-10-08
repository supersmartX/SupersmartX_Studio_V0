# Export Pipeline

```text
MediaRecorder ─► Browser Blob ─► IndexedDB ─► MediaBunny encode ─► MP4 Blob
   │                                                                     │
   │ Creator: presigned PUT ─► R2 ─► /api/exports/complete ─► exports row │
   │ Creator: multipart ─► /api/export-upload ─► R2 + exports row         │
   │ Free: local export only (both upload routes 403 Free first)          │
   └─► job state: pending → encoding → uploading → completed (or failed) │
```

## Upload paths

- **Presigned** (`POST /api/exports/presigned-put`, Creator only; free gets
  403 `Free plan uses local export`): validates platform allowlist, clamps
  resolution, checks crop/duration entitlements, caps concurrency at 3 active
  jobs, creates/updates the job, returns a 15-min signed PUT URL.
- **Multipart** (`POST /api/export-upload`, **Creator only** — Free is rejected
  with 403 `Free plan uses local export` at route L48–50, *before* quota logic;
  an earlier version of this doc said "all plans", corrected in Phase 4): local
  `MAX_EXPORT_SIZE_MB = 200` cap, empty rejection, `video/mp4`-only, platform
  allowlist + free-platform lock, crop/duration checks, atomic quota consume
  with revert on failure.
- **Complete** (`POST /api/exports/complete`, 2048 MiB `MAX_EXPORT_SIZE_BYTES`
  cap — a different ceiling from multipart's 200 MB. **Intentional and
  accepted**: F-03 (owner decision 2026-10-07) — legacy multipart stays at
  200 MB, the primary presigned path carries the shared 2048 MiB cap; do not
  unify — see `TRACEABILITY.md`): key must start with `exports/{userId}/` or the job's
  `staging/{userId}/` key, must match the job's stored key, object verified via
  R2 `HeadObject` (server size wins), then the Phase 3 artifact verification
  below; idempotent on re-delivery (same key + completed job → existing ids),
  orphan R2 object deleted on quota failure.
- **Job create/update** (`POST /api/export-jobs`, `PATCH
  /api/export-jobs/[id]`): platform must be a launch preset, and the
  requested dimensions must match the server-clamped preset exactly.

## Server authority over the platform

Every export stage resolves the platform from `LAUNCH_PLATFORM_PRESETS`
(`src/constants/index.ts`) and derives output dimensions from that preset:

- `presigned-put` ignores client `outputWidth`/`outputHeight` and signs for the
  preset's dimensions, so a client cannot obtain a URL for a larger frame.
- `export-jobs` rejects dimensions that differ from the clamped preset.
- `export-upload` and `exports/complete` re-resolve the platform from the
  request/job rather than trusting stored client input.
- `custom` is rejected at every stage; it exists in `PLATFORM_PRESETS` only for
  backward compatibility and is never purchasable or selectable.

Orientation matters when checking the entitlement ceiling: `exceedsResolutionLimit`
rotates before comparing, so a 1920×1080 Creator ceiling permits 1080×1920.

## Phase 3 export contract (authoritative artifact path)

Requirement (FC-1.1 Phase 3 boundary): **the server verifies the actual bytes
before any claim, quota, or DB write exists** — the server is the final
authority. Contract detail per route: `API-CONTRACTS.md` §4.

### Lifecycle

```text
encode → artifact → byte verification → ownership → completion claim → quota → R2 finalize → record → download
```

1. **encode** — `useExportPipeline` → MediaBunny → MP4 Blob (client; `hasAudio`
   from the engine's own probe, not a UI badge).
2. **artifact** — browser uploads to a staging key (`staging/{userId}/{jobId}.mp4`
   via presigned PUT) or, on the multipart path, the final key.
3. **byte verification** — `/api/exports/complete` walks the **stored object**:
   `collectMp4Metadata` (`src/lib/export/mp4-metadata.ts:234`) performs bounded,
   eTag-pinned ranged reads (16 KiB head, 8-byte box headers, moov ≤ `MAX_MOOV_BYTES`
   = 16 MiB, ≤ `MAX_TOP_LEVEL_BOXES` = 64 top-level boxes; the mdat payload up to
   2 GiB is **never** buffered) and returns `ContainerFacts`;
   `readMp4Artifact` (`mp4-metadata.ts:244`) parses structure; then
   `verifyExportArtifact` (`artifact-verification.ts:93`) issues one verdict in
   fixed order: structure (`not_mp4` → `missing_moov` → `missing_mdat`) →
   `no_video_stream` → `dimension_mismatch` (vs server-clamped preset) →
   `duration_invalid` (absent/zero/NaN/over `MAX_EXPORT_DURATION_SECONDS`) →
   `duration_mismatch` (tolerance `max(1 s, 1 % of claim)`; with no trustworthy
   claim, the byte-rate floor `sizeBytes / EXPORT_BYTES_PER_SECOND`) →
   `missing_audio` (only when the encoder genuinely had audio; extra audio is
   never rejected).
4. **ownership** — key must equal the job's `staging_r2_key` (or the legacy
   adoption path) and sit under the caller's own prefix; cross-user keys `403`.
   Replayed completions of a completed job echo the existing ids only after the
   referenced `exports` row is verified owned.
5. **completion claim** — `claimExportJobFinalization` (atomic token); loser
   gets `409` or the replay echo.
6. **quota** — daily recording allowance (Free 600 s/day, charged `max(claim,
   byte-floor)`), monthly export count, upload count + storage bytes — all
   atomic, all reverted if any later step fails.
7. **R2 finalize** — staging copied to `exports/{userId}/{jobId}.mp4`, final
   object re-`headObject`-verified (exact size/content-type match or `502`),
   staging deleted best-effort (staging key retained on the job so cleanup can
   retry).
8. **record** — `atomicFinalizeExport` writes the `exports` row + job
   `completed` in one token-guarded transaction.
9. **download** — `/api/download` owner+plan+completed+prefix checks, sign URL
   **before** consuming the download credit (`API-CONTRACTS.md` §5 ordering note).

### Failure & retry semantics

| Class | Examples | Behaviour |
| ----- | -------- | --------- |
| Artifact rejection (400) | `not_mp4`, `missing_moov`, `dimension_mismatch`, `duration_mismatch`, `missing_audio`, bad content-type, oversize object | Staging object **deleted**; job stays `uploading` → corrected re-upload + complete retries; **nothing consumed** |
| Ownership/claim conflicts (403/409/413) | key mismatch, foreign key, concurrent finalization, already completed, verified size > cap | As documented in `API-CONTRACTS.md` §4; quotas reverted where consumed |
| R2/IO errors (500/502/503) | reader failure, missing eTag, final-object mismatch | **Not** evidence against the artifact: staging kept (500) or final object deleted + claim released (502); retry-safe |
| Replay | duplicate `/complete` after success | Idempotent echo of `exportId`/`r2Key` — no double charge, no duplicate rows |
| Watermark | Free watermark presence | Pixel property — not assertable from container bytes; decoded-pixel proof is the wm-on vs wm-off pill-region diff in `npm run test:mp4` (`scripts/state8-e2e`), geometry/fillText in the `export-watermark` unit tests (documented in `artifact-verification.test.ts:24-27`) |

Verification layers for this contract: `artifact-verification.test.ts` (unit),
route-level tests against real bytes (same file, Parts 3.10/3.11/3.13),
`state8-composition-accuracy.test.ts`, `state8-detector-blind-spot.test.ts`, and
`npm run test:mp4` (30/30 certified). What each layer does not prove:
`TESTING.md`.

## Failure semantics

| Case | Behavior |
| ---- | -------- |
| R2 ok + DB fail | object deleted, monthly counter reverted, error returned |
| Quota exceeded after upload | object deleted, 403 |
| Retry / duplicate complete | idempotent success, no duplicate rows |
| Auth expiry mid-flow | 401; client re-authenticates, job row persists for resume |
| Encode failure / cancel | job → `failed`; no DB row, no R2 object |
| Browser refresh/close | IndexedDB blob survives; job row persists; re-export resumes |

## Client hygiene (verified)

Object URLs revoked (`useRecorder`, `useMasterRecording`,
`useExportPipeline`, LibraryPanel, studio page), media tracks stopped and
`devicechange` unsubscribed (`useCamera`), intervals cleared, abort
listeners removed, errorMessage sanitized (tag-stripped, 500 chars) in
`PATCH /api/export-jobs/[id]` with strict `VALID_TRANSITIONS`.
