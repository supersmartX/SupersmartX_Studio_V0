# Incident Response

Severity: P0 (payments down, auth bypass, data loss) / P1 (exports,
downloads, webhook failures) / P2 (degraded, single-feature) / P3 (cosmetic).

## Triage (first 15 min)

1. `GET /api/health` + Vercel status + Supabase status (project dashboard) +
   Cloudflare status.
2. Correlate `x-request-id` (every API response) with server logs and the
   structured events in `src/lib/observe/logger.ts`
   (`payment.order_failed`, `api.rate_limited`, …). User ids are hashed —
   join via hash, never log raw PII.
3. Classify data vs availability: for suspected corruption, take a snapshot
   BEFORE any repair writes — `pg_dump "$DIRECT_URL"` (session mode, never the
   pooler), or note the restore point in the Supabase dashboard if PITR is
   enabled (`DATABASE.md` § *Backup and restore*).

## Common runbooks

- **Webhook flood / replay**: safe — `processed_webhooks` dedupes; verify
  signature failures (secret rotation?) vs amount mismatches (price drift?).
- **R2 503s**: check `R2_*` env + bucket policy + key prefix; exports fall
  back to local-only automatically.
- **`DATABASE_NOT_CONFIGURED` / DB errors** (users empty, requests 500):
  production **fails closed** when `DATABASE_URL` is missing or is not a
  `postgres://` DSN — restore the Supabase pooler URL (`:6543`) in
  `DATABASE_URL` and the direct URL (`:5432`) in `DIRECT_URL`, redeploy, and
  verify `/api/health` returns `healthy`. Check `checks.db_host` on an
  authenticated probe to prove which database the process is bound to; a wrong
  host means an empty database, not lost data. There is no file or `:memory:`
  fallback in production.
- **Stuck export jobs**: inspect `export_jobs` by status; failed jobs are
  terminal and safe to leave; delete only via cleanup endpoint.
- **Account lockouts (legit users)**: `locked_until` clears automatically
  after 15 min; do not hand-edit unless P1.

## Comms

P0/P1: status note within 30 min, updates hourly, post-mortem within 5 days.
Never include tokens, secrets, or raw user data in
incident notes.
