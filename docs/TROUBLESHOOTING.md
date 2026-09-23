# Troubleshooting

| Symptom | Likely cause | Fix |
| ------- | ------------ | --- |
| `NEXTAUTH_SECRET is not set` crash in prod | env missing | set 32+ char secret, redeploy |
| `CASHFREE_SECRET_KEY` build warning | env missing | expected in dev; must be set in prod |
| `Storage not configured` 503 | any `R2_*` var missing | set all four; bucket private |
| Empty users / sessions vanish | `:memory:` fallback (no Turso on serverless) | set Turso pair, redeploy |
| `FOREIGN KEY constraint failed` on old DB | pre-v10 orphans | v10 migration filters them on next boot; inspect `exports`/`user_stats` orphans if it recurs |
| Cleanup endpoint 401 | `CLEANUP_SECRET` unset/mismatch | set same value in env + cron caller |
| Monthly limit hit unexpectedly | `monthly_export_counts` for current period | check `getMonthlyExportCount`; Creator is unlimited |
| Free user gets 403 on Instagram/custom | intended | Creator-only formats (ENTITLEMENTS.md) |
| Playwright fails locally | browsers not installed | `npx playwright install` |
| Vitest `act(...)` stderr noise | React state updates in hook tests | non-failing; wrap in `act` when touching those tests |
| Lint `no-console` | `console.log` in prod code | use `console.warn/error` or the observe logger |
