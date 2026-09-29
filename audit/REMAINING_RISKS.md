# Remaining Risks

## Open P1

None in reviewed source paths.

## Closed since the previous pass

- **Cashfree environment split** (`CASHFREE_ENV` vs `NEXT_PUBLIC_CASHFREE_ENV`):
  a build-time/runtime mismatch let checkout render in one Cashfree environment
  while the order belonged to the other, so the payment could never activate.
  Now fails closed: `isCashfreeEnvConsistent()` 503s order creation and the
  client aborts if the order's authoritative `env` differs from its SDK mode.
  Regression tests: `src/__tests__/payment-fulfillment.test.ts`.
- **Portrait exports rejected for Creator**: the per-axis resolution check
  rejected valid 1080×1920 presets under a 1920×1080 ceiling.
  `exceedsResolutionLimit` now treats the ceiling as an orientation-independent
  envelope. Regression tests: `src/__tests__/entitlements.test.ts`.
- **Export platform authority**: `presigned-put` signed URLs for
  client-supplied dimensions and every stage accepted the `custom` platform.
  All four export stages now resolve dimensions from `LAUNCH_PLATFORM_PRESETS`
  and reject `custom`. Regression tests: `src/__tests__/export-platform-matrix.test.ts`.

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
   `payment.order_created` vs `findPendingOrder` misses. Fulfillment also now
   throws on a zero-row plan update instead of reporting a phantom activation.

## Open P3

3. **`middleware` file-convention deprecation** (Next 16 prefers `proxy`).
   Works today; rename at the next framework upgrade.
4. **Dev-only moderate advisory** (esbuild via vitest/vite): dev server
   exposure only; fix requires breaking vitest major — deferred.
5. **17 lint warnings** (unused vars/args, one `console.log`): noise, no
   errors, all in files outside the changed surface. Clean opportunistically
   when touching those files.
6. **Scale ceilings (documented, not yet load-tested)**: multipart uploads
   proxy through serverless functions (200 MB cap guards this); encode is
   client-side (server scales, low-end devices don't); export list caps at
   100 rows. See PRODUCTION_VALIDATION.md performance checks.

## Explicitly out of scope / not verified

- Production bucket policy, OAuth, webhook delivery, email delivery:
  PRODUCTION_VALIDATION.md.
- Load testing at 1k/10k/100k users — modeled thresholds only.
