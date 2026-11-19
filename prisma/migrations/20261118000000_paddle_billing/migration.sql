-- Paddle billing foundation. Additive only; legacy entitlements remain untouched.

CREATE TABLE "billing_accounts" (
  "user_id" text NOT NULL,
  "provider" text NOT NULL DEFAULT 'paddle',
  "provider_customer_id" text,
  "provider_subscription_id" text,
  "plan" text NOT NULL DEFAULT 'free',
  "status" text NOT NULL DEFAULT 'free',
  "legacy_plan" text,
  "legacy_paid_through_at" timestamptz(3),
  "paid_through_at" timestamptz(3),
  "next_charge_at" timestamptz(3),
  "cancel_at_period_end" boolean NOT NULL DEFAULT false,
  "canceled_at" timestamptz(3),
  "last_event_id" text,
  "last_event_at" timestamptz(3),
  "created_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_accounts_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "billing_accounts_user_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);


CREATE UNIQUE INDEX "billing_accounts_provider_customer_id_key" ON "billing_accounts"("provider_customer_id");
CREATE UNIQUE INDEX "billing_accounts_provider_subscription_id_key" ON "billing_accounts"("provider_subscription_id");

CREATE TABLE "billing_reservations" (
  "id" text NOT NULL,
  "user_id" text NOT NULL,
  "plan" text NOT NULL,
  "period" text NOT NULL,
  "currency" text NOT NULL,
  "consent_hash" text NOT NULL,
  "status" text NOT NULL DEFAULT 'reserved',
  "provider_operation_id" text,
  "provider_transaction_id" text,
  "remote_status" text,
  "created_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_reservations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_reservations_user_fk" FOREIGN KEY ("user_id") REFERENCES "billing_accounts"("user_id") ON DELETE CASCADE,
  CONSTRAINT "billing_reservations_status_allowed" CHECK ("status" IN ('reserved','pending','confirmed','failed','canceled','expired'))
);

CREATE UNIQUE INDEX "billing_reservations_user_provider_operation_key"
  ON "billing_reservations"("user_id","provider_operation_id");
CREATE INDEX "billing_reservations_status_created_at_idx" ON "billing_reservations"("status","created_at");
CREATE UNIQUE INDEX "billing_reservations_one_active_per_user"
  ON "billing_reservations"("user_id")
  WHERE "status" IN ('reserved','pending');

CREATE TABLE "billing_events" (
  "event_id" text NOT NULL,
  "user_id" text,
  "provider" text NOT NULL DEFAULT 'paddle',
  "event_type" text NOT NULL,
  "payload_json" text NOT NULL,
  "status" text NOT NULL DEFAULT 'received',
  "attempt_count" integer NOT NULL DEFAULT 0,
  "next_attempt_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_error" text,
  "received_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" timestamptz(3),
  "occurred_at" timestamptz(3),
  "lease_owner" text,
  "leased_until" timestamptz(3),
  "lease_token" text,
  CONSTRAINT "billing_events_pkey" PRIMARY KEY ("event_id"),
  CONSTRAINT "billing_events_user_fk" FOREIGN KEY ("user_id") REFERENCES "billing_accounts"("user_id") ON DELETE SET NULL,
  CONSTRAINT "billing_events_status_allowed" CHECK ("status" IN ('received','processing','processed','failed','ignored','review'))
);

CREATE INDEX "billing_events_status_next_attempt_at_idx" ON "billing_events"("status","next_attempt_at");
CREATE INDEX "billing_events_status_leased_until_idx" ON "billing_events"("status","leased_until");

CREATE TABLE "billing_transactions" (
  "id" text NOT NULL,
  "provider_transaction_id" text NOT NULL,
  "user_id" text,
  "provider_subscription_id" text,
  "plan" text NOT NULL,
  "status" text NOT NULL,
  "amount" decimal(12,2) NOT NULL,
  "currency" text NOT NULL,
  "paid_at" timestamptz(3),
  "period_start_at" timestamptz(3),
  "period_end_at" timestamptz(3),
  "entitlement_granted_at" timestamptz(3),
  "refunded_at" timestamptz(3),
  "disputed_at" timestamptz(3),
  "payload_json" text NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_transactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_transactions_provider_id_key" UNIQUE ("provider_transaction_id"),
  CONSTRAINT "billing_transactions_user_fk" FOREIGN KEY ("user_id") REFERENCES "billing_accounts"("user_id") ON DELETE SET NULL
);

CREATE INDEX "billing_transactions_user_created_at_idx" ON "billing_transactions"("user_id","created_at");

CREATE TABLE "billing_operations" (
  "id" text NOT NULL,
  "user_id" text NOT NULL,
  "operation" text NOT NULL,
  "resource_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "payload_json" text NOT NULL,
  "last_error" text,
  "created_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" timestamptz(3),
  CONSTRAINT "billing_operations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_operations_user_fk" FOREIGN KEY ("user_id") REFERENCES "billing_accounts"("user_id") ON DELETE CASCADE
);

CREATE INDEX "billing_operations_user_created_at_idx" ON "billing_operations"("user_id","created_at");
CREATE INDEX "billing_operations_status_created_at_idx" ON "billing_operations"("status","created_at");
CREATE UNIQUE INDEX "billing_operations_one_open_cancel_per_subscription"
  ON "billing_operations"("user_id","resource_id")
  WHERE "operation" = 'cancel_at_period_end' AND "status" IN ('pending','uncertain');

CREATE TABLE "billing_adjustments" (
  "provider_adjustment_id" text NOT NULL,
  "transaction_id" text NOT NULL,
  "action" text NOT NULL,
  "action_type" text NOT NULL,
  "status" text NOT NULL,
  "updated_at" timestamptz(3) NOT NULL,
  CONSTRAINT "billing_adjustments_pkey" PRIMARY KEY ("provider_adjustment_id"),
  CONSTRAINT "billing_adjustments_transaction_fk" FOREIGN KEY ("transaction_id") REFERENCES "billing_transactions"("provider_transaction_id") ON DELETE CASCADE
);

CREATE INDEX "billing_adjustments_transaction_status_idx" ON "billing_adjustments"("transaction_id","status");
