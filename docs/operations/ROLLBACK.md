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
  `../engineering/DATABASE.md` § *Backup and restore*.
- Never run `DROP TABLE` by hand; never run `prisma db push` to "reset" a
  schema — it drops the partial unique indexes that enforce one live checkout
  (`billing_reservations_one_active_per_user`, legacy
  `pending_orders_one_live_per_user`) and one open cancellation
  (`billing_operations_one_open_cancel_per_subscription`).

## Payments/storage

- Paddle Billing webhook receipt is idempotent (`billing_events` primary key);
  replaying events after a rollback is safe. Entitlement grants are additionally
  deduplicated per provider transaction by the `entitlement_granted_at` claim,
  so worker replay cannot double-grant.
- R2 objects are content-addressed by UUID keys; rollback never deletes
  objects. Orphan sweep is covered by account deletion + nightly cleanup.

## Rollback drill (recommended quarterly)

Redeploy the previous production build against a scratch Supabase project
restored from the latest backup (`../engineering/DATABASE.md` § *Backup and restore*), replay
the smoke list, record result.

## Paddle rollback boundary

Do not roll back to a build that permits Sandbox on Vercel Production. Retain the
Production-only guard and rebuild with both selectors `production`, version
`2022-09-01`, and the same operator-managed Production credential pair. Do not
promote a Sandbox build or change gateways to recover from a 401. Unknown orders
stay blocked; never delete/reset/release pending rows as a rollback step.
