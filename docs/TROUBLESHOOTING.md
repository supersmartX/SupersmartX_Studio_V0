# Troubleshooting

| Symptom | Likely cause | Fix |
| ------- | ------------ | --- |
| `NEXTAUTH_SECRET is not set` crash in prod | env missing | set 32+ char secret, redeploy |
| `CASHFREE_SECRET_KEY` build warning | env missing | expected in dev; must be set in prod |
| `Storage not configured` 503 | any `R2_*` var missing | set all four; bucket private |
| Empty users / sessions vanish | wrong or non-durable `DATABASE_URL` binds the app to an empty database (production **fails closed** with `DATABASE_NOT_CONFIGURED` rather than inventing one) | check `db_host` from an authenticated `/api/health`, then fix the connection strings and redeploy |
| `DATABASE_NOT_CONFIGURED` error in prod | `DATABASE_URL` missing, empty, or not a `postgres://`/`postgresql://` DSN | set the Supabase **pooler** URL (`:6543`) in `DATABASE_URL` and the direct URL (`:5432`) in `DIRECT_URL`, then redeploy |
| `prisma migrate deploy` fails: `relation "users" already exists` | schema exists but `_prisma_migrations` does not record `0_init` (database created outside Prisma Migrate) | verify the schema matches `0_init`, then `npx prisma migrate resolve --applied 0_init` once — see DATABASE.md. Never edit the migration to force it |
| `FOREIGN KEY constraint failed` | application wrote a child row for a missing `users` row, or a restore landed out of order | inspect the offending `exports`/`user_stats`/`pending_orders` row; foreign keys are enforced by PostgreSQL, unlike the retired libSQL driver |
| Cleanup endpoint 401 | `CLEANUP_SECRET` unset/mismatch | set same value in env + cron caller |
| Monthly limit hit unexpectedly | `monthly_export_counts` for current period | check `getMonthlyExportCount`; Creator is unlimited |
| Free user gets 403 on Instagram/custom | intended | Creator-only formats (ENTITLEMENTS.md) |
| Playwright fails locally | browsers not installed | `npx playwright install` |
| Vitest `act(...)` stderr noise | React state updates in hook tests | non-failing; wrap in `act` when touching those tests |
| Lint `no-console` | `console.log` in prod code | use `console.warn/error` or the observe logger |
