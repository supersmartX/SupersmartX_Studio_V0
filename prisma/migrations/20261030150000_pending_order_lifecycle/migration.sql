-- W2 — pending-order lifecycle, one live checkout per user, per-user lock.
--
-- Hand-written. The partial unique index below has no Prisma representation, so
-- `prisma migrate dev` / `prisma db push` will report drift and must never be
-- run against a database that carries this migration.
--
-- The backfill makes NO decision about money and does not infer fulfilment:
--   * every historical order is classified `unverified`;
--   * `processed_webhooks` claims are preserved exactly as they are, and none
--     is converted into a grant or a `fulfilled` row;
--   * there is no exact per-order evidence for a historical claim. The
--     `fulfilled_at` marker is introduced by this migration and did not exist
--     before it, and `plan_expires_at > processed_at` is NOT a substitute: for
--     a renewal the earlier term already puts the account's expiry past the new
--     claim, so that comparison would certify an order whose own grant never
--     landed. Treating it as proof was the W8 false-positive defect.
-- No historical order is closed, deleted, re-granted, or extended. Rows that
-- need a decision are classified by the operator-driven report/apply step
-- (docs/PRODUCTION-RUNBOOK.md), which reads the gateway; a missing claim is not
-- evidence of an unpaid order either.

ALTER TABLE "pending_orders"
  ADD COLUMN "status" text,
  ADD COLUMN "closed_at" timestamptz(3),
  ADD COLUMN "close_reason" text,
  ADD COLUMN "held_at" timestamptz(3),
  ADD COLUMN "hold_reason" text,
  ADD COLUMN "fulfilled_at" timestamptz(3),
  ADD COLUMN "last_checked_at" timestamptz(3),
  ADD COLUMN "probe_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN "first_probed_at" timestamptz(3),
  ADD COLUMN "termination_requested_at" timestamptz(3);

-- Nothing is inferred from the account's expiry. Every pre-existing order is
-- unverified until an operator (or a gateway-confirmed reconciliation) says
-- otherwise.
UPDATE "pending_orders" SET "status" = 'unverified' WHERE "status" IS NULL;

ALTER TABLE "pending_orders"
  ALTER COLUMN "status" SET DEFAULT 'open',
  ALTER COLUMN "status" SET NOT NULL;

ALTER TABLE "pending_orders"
  ADD CONSTRAINT "pending_orders_status_allowed" CHECK (
    "status" IN ('creating', 'open', 'termination_requested', 'held_review', 'unverified', 'fulfilled', 'closed')
  ),
  -- Every state that has left the live-checkout set carries both a closure
  -- timestamp and a reason; every live or unclassified row carries neither.
  ADD CONSTRAINT "pending_orders_closure_matches_status" CHECK (
    ("status" IN ('creating', 'open', 'termination_requested', 'unverified')) =
    ("closed_at" IS NULL AND "close_reason" IS NULL)
  ),
  ADD CONSTRAINT "pending_orders_close_reason_allowed" CHECK (
    "close_reason" IS NULL OR "close_reason" IN (
      'paid_fulfilled',
      'held_unapplied',
      'gateway_expired',
      'gateway_terminated',
      'gateway_rejected_create',
      'orphaned_no_gateway_record',
      'hold_void_unpaid',
      'operator_closed'
    )
  ),
  ADD CONSTRAINT "pending_orders_fulfilled_at_matches_status" CHECK (
    ("status" = 'fulfilled') = ("fulfilled_at" IS NOT NULL)
  ),
  ADD CONSTRAINT "pending_orders_held_matches_status" CHECK (
    "status" <> 'held_review' OR ("held_at" IS NOT NULL AND "hold_reason" IS NOT NULL)
  ),
  ADD CONSTRAINT "pending_orders_hold_reason_allowed" CHECK (
    "hold_reason" IS NULL OR "hold_reason" IN (
      'fulfilment_rejected',
      'fulfilment_failed',
      'claim_unentitled',
      'late_payment_unapplied'
    )
  ),
  -- Hold history survives resolution, so a fulfilled order may still say it was
  -- held once; a live order may not.
  ADD CONSTRAINT "pending_orders_hold_only_when_closed" CHECK (
    "held_at" IS NULL OR "status" IN ('held_review', 'fulfilled', 'closed')
  ),
  ADD CONSTRAINT "pending_orders_termination_only_when_requested" CHECK (
    "termination_requested_at" IS NULL OR "status" IN ('termination_requested', 'held_review', 'fulfilled', 'closed')
  ),
  ADD CONSTRAINT "pending_orders_unverified_is_untouched" CHECK (
    "status" <> 'unverified' OR ("fulfilled_at" IS NULL AND "held_at" IS NULL AND "termination_requested_at" IS NULL)
  ),
  ADD CONSTRAINT "pending_orders_probe_count_non_negative" CHECK ("probe_count" >= 0);

-- One live checkout per user. This is the mutex that makes "reserve before
-- create" safe: a concurrent insert loses with SQLSTATE 23505 instead of
-- creating a second payable order. `held_review` is deliberately absent — a
-- late payment must be recordable while another checkout is live — and
-- `unverified` is absent because historical duplicates are expected to exist.
CREATE UNIQUE INDEX "pending_orders_one_live_per_user"
  ON "pending_orders" ("user_id")
  WHERE "status" IN ('creating', 'open', 'termination_requested');

CREATE INDEX "pending_orders_status_created_at_idx"
  ON "pending_orders" ("status", "created_at");

-- Serializes reconciliation + reservation per user across serverless isolates.
-- `locked_at` is a TTL so a holder that died mid-request cannot wedge checkout.
CREATE TABLE "checkout_locks" (
  "user_id" text NOT NULL,
  "token" text NOT NULL,
  "locked_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "checkout_locks_pkey" PRIMARY KEY ("user_id")
);
