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
