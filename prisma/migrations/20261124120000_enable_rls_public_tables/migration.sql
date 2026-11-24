-- Row Level Security guard for tables created by Prisma migrations.
--
-- Supabase database linters 0013 (rls_disabled_in_public) and 0023
-- (sensitive_columns_exposed, the `token` column on `checkout_locks`) flagged
-- every public table introduced by the Prisma migration history: schema
-- migrations only run `CREATE TABLE` and never enable RLS, while the remaining
-- public tables have RLS switched on outside this history.
--
-- The application reaches PostgreSQL exclusively through Prisma over a
-- privileged connection owner (which bypasses RLS as table owner, as does the
-- Supabase `service_role`), and no client queries PostgREST. Enabling RLS
-- without any `CREATE POLICY` therefore denies all `anon`/`authenticated`
-- PostgREST access while leaving application behaviour unchanged.
--
-- These statements are idempotent: enabling RLS on a table that already has it
-- enabled outside this migration history is a no-op, so re-running against the
-- deployed database is safe.

-- `_prisma_migrations` is created by Prisma before `migrate deploy` applies
-- pending migrations, but schema-replay tools that re-execute the migration
-- history into a shadow database (e.g. `prisma migrate diff --from-migrations`)
-- do not necessarily run with the migrations table present. IF EXISTS keeps
-- those replays working while still enabling RLS whenever the table exists,
-- as it always does in a real `migrate deploy`.
ALTER TABLE IF EXISTS "public"."_prisma_migrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."billing_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."billing_adjustments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."billing_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."billing_operations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."billing_reservations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."billing_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."checkout_locks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."daily_recording_seconds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."deleted_identities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."export_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."exports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."monthly_export_counts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."order_notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."pending_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."processed_webhooks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."rate_limit_buckets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."reset_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."schema_meta" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."user_stats" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;
