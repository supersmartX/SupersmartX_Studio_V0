ALTER TABLE "billing_adjustments"
  ADD COLUMN "amount" decimal(12,2),
  ADD COLUMN "currency" text;
