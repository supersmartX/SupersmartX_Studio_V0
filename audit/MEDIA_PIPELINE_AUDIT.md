# MEDIA PIPELINE AUDIT

Flow: Camera → MediaRecorder → Blob → IndexedDB → MediaBunny encode →
MP4 → presigned PUT or multipart → complete → exports row → signed URL →
download. Client engine: mediabunny 1.59.0 exact (MPL-2.0 — legal note
DEP/QUAL, P3).

## Failure-boundary review (code-inspected)

| Boundary | Handling | Verdict |
| -------- | -------- | ------- |
| Browser refresh/close | IndexedDB blob persists; job row persists; re-export resumes | OK |
| OAuth redirect mid-flow | job row persists; client resumes post-auth | OK (pendingDownload intent in auth-guard) |
| Tab close during PUT | multipart: no row (quota reverted on catch); presigned: orphan object w/o row until complete; no sweeper for never-completed PUTs | P3 gap: uncompleted-object sweep absent |
| Network interruption | client retry; complete idempotent | OK |
| Camera/mic denial | useCamera stops tracks, unsubscribes devicechange; permission-error states | OK |
| Encode failure/cancel | job → failed; abort listeners removed; no row/object | OK |
| Upload failure | quota revert + no row (multipart); complete 400 (presigned) | OK |
| R2 failure | 503/500 generic; counters reverted | OK |
| DB failure post-R2 | object deleted + counter reverted | OK |
| Auth expiry mid-flow | 401; job persists for resume | OK |
| Plan expiry mid-flow | 403 at next call; terminal states safe | OK |
| Duplicate upload/retry | idempotent complete; webhook dedupe | OK |
| Cancel/unmount | abort() all + revokeObjectURL (pipeline :42-50); recorder stops + clears intervals + revokes URLs; camera tracks stopped | OK — no leaks found |
| Concurrent exports | cap 3, 4th → 429 | OK |

## Leaks/races

Object-URL revoke, track stop, listener/interval cleanup verified across
useCamera/useRecorder/useExportPipeline/useMasterRecording/VideoPlayer/
LibraryPanel (65 hygiene hits; tests assert revoke). No stale-closure or
race defects found. errorMessage tag-stripped + 500-char capped.

## Findings

- Presigned orphan sweep: objects PUT but never completed have no janitor
  (cleanup covers jobs, not key-space orphans). P3 — recommend prefix-list
  reconciliation vs exports table (feeds R2 audit + cost).
- SEC-001/STO-001/BUS-001 apply at the complete boundary (see those files).
- MPL-2.0 vendoring check: library consumed from node_modules unmodified —
  no copyleft contamination found; acquirer counsel to confirm (P3).
