# Storage (Cloudflare R2)

Client: `src/lib/r2.ts` over `@aws-sdk/client-s3` with an R2 endpoint.
All four `R2_*` env vars required; otherwise routes return 503 and the app
falls back to local-only export.

## Security posture

- Bucket must be **private** (no public access / custom-domain passthrough).
  The app never constructs public object URLs — downloads go through
  short-lived signed GET URLs issued only after auth + ownership +
  entitlement checks (`/api/download`, `/preview`).
- Keys are owner-namespaced and server-generated:
  `exports/{userId}/{uuid}.mp4`, `recordings/{userId}/{uuid}.{webm,mp4}`.
  Upload extensions allowlisted (`webm`, `mp4`); export content restricted
  to `video/mp4` (multipart) with 200 MB cap.
- TTLs: PUT 900 s, GET default 3600 s (`R2_SIGNED_URL_TTL_SECONDS`).
- Rate limits: presigned 10/h, export-upload 20/h, download 30/h (per user,
  in-memory — see scale note below).

## Lifecycle & orphans

- Quota-failure paths delete the just-uploaded object and revert counters.
- Account deletion (`DELETE /api/user/delete`) enumerates the user's keys
  from the DB (authoritative) plus the R2 prefix (orphan sweep), deletes
  objects idempotently (missing = success), then deletes DB rows children-
  first.
- Nightly cleanup (`POST /api/export-jobs/cleanup`) removes jobs >30 days
  with their R2 objects; linked exports survive via `ON DELETE SET NULL`.

## Scale note

R2 data-plane scales with Cloudflare. App-side limits at scale: in-memory
rate limiter resets on serverless cold starts (move to Redis past
single-instance traffic), and multipart uploads proxy through serverless
functions (prefer presigned PUT for large files at high concurrency).
