# Rollback

## Application

Vercel: redeploy the previous green deployment (instant). Self-hosted:
re-deploy the previous image/commit, then run the smoke list in
DEPLOYMENT.md.

## Database

Migrations are additive — rolling the app back does NOT roll the schema back,
and no code in this repo requires downgrading:

- Every migration in `prisma/migrations` since the `0_init` baseline is
  additive (new tables, new nullable/defaulted columns, new indexes or
  constraints) — an older build simply ignores them.
- The current build has no down-migrations, and `_prisma_migrations` is the only
  record of what is applied. Never edit it by hand.
- If a deploy must be reverted because a migration itself is wrong, either
  restore the pre-deploy backup into a scratch Supabase project and cut over, or
  ship a new additive migration that corrects it. Procedure:
  `DATABASE.md` § *Backup and restore*.
- Never run `DROP TABLE` by hand; never run `prisma db push` to "reset" a
  schema — it drops the `pending_orders_one_live_per_user` partial index that
  enforces one live checkout per user.

## Payments/storage

- Cashfree webhook handler is idempotent (`processed_webhooks`); replaying
  events after rollback is safe.
- R2 objects are content-addressed by UUID keys; rollback never deletes
  objects. Orphan sweep is covered by account deletion + nightly cleanup.

## Rollback drill (recommended quarterly)

Redeploy the previous production build against a scratch Supabase project
restored from the latest backup (`DATABASE.md` § *Backup and restore*), replay
the smoke list, record result.
