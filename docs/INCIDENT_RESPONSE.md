# Incident Response

Severity: P0 (payments down, auth bypass, data loss) / P1 (exports,
downloads, webhook failures) / P2 (degraded, single-feature) / P3 (cosmetic).

## Triage (first 15 min)

1. `GET /api/health` + Vercel status + Turso status + Cloudflare status.
2. Correlate `x-request-id` (every API response) with server logs and the
   structured events in `src/lib/observe/logger.ts`
   (`payment.order_failed`, `api.rate_limited`, …). User ids are hashed —
   join via hash, never log raw PII.
3. Classify data vs availability: for suspected corruption, snapshot Turso
   (point-in-time) BEFORE any repair writes.

## Common runbooks

- **Webhook flood / replay**: safe — `processed_webhooks` dedupes; verify
  signature failures (secret rotation?) vs amount mismatches (price drift?).
- **R2 503s**: check `R2_*` env + bucket policy + key prefix; exports fall
  back to local-only automatically.
- **DB errors / `:memory:` symptoms** (empty users, lost sessions): Turso
  env missing on serverless — restore env, redeploy, verify
  `TURSO_DATABASE_URL` present.
- **Stuck export jobs**: inspect `export_jobs` by status; failed jobs are
  terminal and safe to leave; delete only via cleanup endpoint.
- **Account lockouts (legit users)**: `locked_until` clears automatically
  after 15 min; do not hand-edit unless P1.

## Comms

P0/P1: status note within 30 min, updates hourly, post-mortem within 5 days
filed under `audit/`. Never include tokens, secrets, or raw user data in
incident notes.
