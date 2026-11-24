CREATE TABLE "rate_limit_buckets" (
  "key" text NOT NULL,
  "count" integer NOT NULL DEFAULT 0,
  "reset_at" timestamptz(3) NOT NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "rate_limit_buckets_reset_at_idx" ON "rate_limit_buckets"("reset_at");
