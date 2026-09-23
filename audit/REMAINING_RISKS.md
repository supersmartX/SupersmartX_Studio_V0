# Remaining Risks

## Open P1

None in reviewed source paths.

## Open P2

1. **In-memory rate limiter is not distributed** (`src/lib/rate-limit.ts`,
   plus a second copy in `cashfree/order/route.ts`). Resets on serverless
   cold starts; a determined actor can exceed nominal limits by rotating
   isolates. Threshold: acceptable to ~1k users; move to Redis (Upstash)
   before 10k. Partially mitigated: entitlement/ownership checks are
   independent of rate limiting.
2. **`PRAGMA foreign_keys = OFF` fallback in cashfree/order** can insert a
   `pending_orders` row dangling off a missing user (by design, last-resort).
   Webhook path looks the order up and fails closed (`Unknown order`), so no
   plan is granted; still, prefer alerting over silent insert. Monitor
   `payment.order_created` vs `findPendingOrder` misses.

## Open P3

3. **`middleware` file-convention deprecation** (Next 16 prefers `proxy`).
   Works today; rename at the next framework upgrade.
4. **Dev-only moderate advisory** (esbuild via vitest/vite): dev server
   exposure only; fix requires breaking vitest major — deferred.
5. **28→25 lint warnings** (unused vars/args, two `console.log`): noise, no
   errors. Clean opportunistically when touching those files.
6. **Scale ceilings (documented, not yet load-tested)**: multipart uploads
   proxy through serverless functions (200 MB cap guards this); encode is
   client-side (server scales, low-end devices don't); export list caps at
   100 rows. See PRODUCTION_VALIDATION.md performance checks.

## Explicitly out of scope / not verified

- Production bucket policy, OAuth, webhook delivery, email delivery:
  PRODUCTION_VALIDATION.md.
- Load testing at 1k/10k/100k users — modeled thresholds only.
