-- Recovery for four checkout reservations created on 2026-11-20 (IST) whose
-- Paddle create call failed before any transaction existed.
--
-- Confirmed on 2026-11-20 before writing this file:
--   * Paddle Sandbox transactions: 0 (no transaction.* events ever emitted).
--   * All four rows: status = 'pending', remote_status = 'provider_create_uncertain',
--     provider_transaction_id IS NULL.
-- Marking these rows failed therefore cannot orphan a provider object.
--
-- Scope: status only. No rows are deleted and no entitlement, plan, account,
-- transaction or adjustment column is touched. `failed` is permitted by
-- billing_reservations_status_allowed (@see migration 20261118000000_paddle_billing).
--
-- This is NOT a Prisma migration: `prisma migrate` and `prisma db push` never
-- read prisma/recovery. Re-runnable: the status/remote-status/NULL guards make a
-- second run a no-op.
--
-- Do not run without explicit approval. Do not wrap in application code.

BEGIN;

UPDATE billing_reservations
   SET status = 'failed'
 WHERE status = 'pending'
   AND remote_status = 'provider_create_uncertain'
   AND provider_transaction_id IS NULL
   AND id IN (
     '72f0a281-ee91-4c92-9b04-5ad2162aedd3',
     '51d98841-683b-4183-8a8a-41ac7b5d862f',
     'bbdbdb22-2a17-4a33-8fee-84940afcde79',
     'ae892f56-48bd-4c77-8f2a-512d41758345'
   );
-- Expected: UPDATE 4 on the first run, UPDATE 0 afterwards.

-- Post-condition 1: the four rows are terminal and still present for audit.
SELECT id, user_id, status, remote_status, provider_transaction_id, created_at
  FROM billing_reservations
 WHERE id IN (
     '72f0a281-ee91-4c92-9b04-5ad2162aedd3',
     '51d98841-683b-4183-8a8a-41ac7b5d862f',
     'bbdbdb22-2a17-4a33-8fee-84940afcde79',
     'ae892f56-48bd-4c77-8f2a-512d41758345'
   )
 ORDER BY created_at;

-- Post-condition 2: none of the four users has a reservation left in the
-- blocking states (`reserved` / `pending`). Expect zero rows.
SELECT user_id, id, status
  FROM billing_reservations
 WHERE user_id IN (
     '6ec602d0-1718-43a1-a5c1-18d9ee40c35c',
     'ad3dcda2-c0b3-4b50-afd3-47526ab581a3',
     'b5609262-9c51-444f-a766-29e8927f159a',
     'dfa9e4b4-d3aa-4370-a8ae-5931fd836e2d'
   )
   AND status IN ('reserved', 'pending');

COMMIT;
