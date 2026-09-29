# Export Pipeline

```text
MediaRecorder ─► Browser Blob ─► IndexedDB ─► MediaBunny encode ─► MP4 Blob
   │                                                                     │
   │ Creator: presigned PUT ─► R2 ─► /api/exports/complete ─► exports row │
   │ Any plan: multipart ─► /api/export-upload ─► R2 + exports row        │
   └─► job state: pending → encoding → uploading → completed (or failed) │
```

## Upload paths

- **Presigned** (`POST /api/exports/presigned-put`, Creator only; free gets
  403 `Free plan uses local export`): validates platform allowlist, clamps
  resolution, checks crop/duration entitlements, caps concurrency at 3 active
  jobs, creates/updates the job, returns a 15-min signed PUT URL.
- **Multipart** (`POST /api/export-upload`, all plans): 200 MB cap, empty
  rejection, `video/mp4`-only, platform allowlist + free-platform lock,
  crop/duration checks, atomic quota consume with revert on failure.
- **Complete** (`POST /api/exports/complete`): key must start with
  `exports/{userId}/`, must match the job's stored key, object verified via
  R2 `HeadObject` (server size wins), idempotent on re-delivery
  (same key + completed job → existing ids), orphan R2 object deleted on
  quota failure.
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
