# DATABASE AUDIT

Engine: libSQL (local SQLite file; Turso prod). Migrations v1–v10
idempotent; FK pragma enforced per connection; CASCADE/SET NULL fixed in
v10 and regression-tested (cascade delete, SET NULL cleanup, FK rejection,
ownership scoping). Atomic single-statement counters (upload/download/
monthly) — concurrency-safe, tested incl. parallel increments.

## Query patterns (reviewed)

- All resource reads ownership-scoped with covering indexes
  (idx_exports_user_created, idx_export_jobs_user_created/status,
  idx_users_email, idx_monthly user_period, idx_pending user).
- Token consume is atomic DELETE…RETURNING with expiry predicate — good.
- No dynamic SQL construction (all parameterized); no N+1 (single-row
  reads; lists are single SELECTs); no transactions wrapping multi-step
  flows — compensated instead by quota-revert + orphan-delete paths
  (correct for serverless; acceptable).

## Gaps

- DB-001 (P3): complete stores client outputWidth/Height (|| 1920
  fallback); download counts before signing.
- DB-002 (P3): no retention purge — reset_tokens (emails), pending_orders,
  processed_webhooks grow unbounded.
- DB-003 (P3): monthly-quota machinery dormant (all plans null) — wire or
  remove.
- user/delete crash window (R2-then-DB) is retry-safe; noted, no change.
- Exports LIMIT 100 / recordings single-page lists will need pagination
  past ~1k rows (API-002).

## State-consistency verdict

Critical state cannot silently diverge: FKs enforced, counters atomic,
complete idempotent, webhook deduped, cleanup SET NULL-safe. Residual risk
is retention growth + metadata fidelity, both P3. No P0/P1 data findings
beyond the two API-enforcement gaps (SEC-001, BUS-001) that land in the DB
as unchecked values.
