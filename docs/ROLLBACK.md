# Rollback

## Application

Vercel: redeploy the previous green deployment (instant). Self-hosted:
re-deploy the previous image/commit, then run the smoke list in
DEPLOYMENT.md.

## Database

Migrations are additive and idempotent — rolling the app back does NOT roll
the schema back, and no code in this repo requires downgrading:

- v10 table rebuilds preserve all reachable rows; re-running is safe
  (stale `*_new` tables are dropped first).
- If a deploy must be reverted because of a NEW migration, restore Turso
  from the pre-deploy point-in-time backup instead of hand-editing schema.
- Never run `DROP TABLE` by hand; never edit `schema_meta` by hand.

## Payments/storage

- Cashfree webhook handler is idempotent (`processed_webhooks`); replaying
  events after rollback is safe.
- R2 objects are content-addressed by UUID keys; rollback never deletes
  objects. Orphan sweep is covered by account deletion + nightly cleanup.

## Rollback drill (recommended quarterly)

Redeploy previous production build to staging, point at a Turso branch,
replay the smoke list, record result in `audit/`.
