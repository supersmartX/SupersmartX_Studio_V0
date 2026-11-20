# Payment remediation tracker

## Architecture and approved scope

Preserve the existing Next.js/Prisma application structure. Use a dedicated `/pay` client boundary for Paddle.js, exact merchant URL configuration, authoritative original-enrollment validation for renewal transactions, and user-row locks within existing billing transactions. Load the provider script only at checkout; bounded SDK reads and worker batches constrain latency and provider cost. Locks serialize one user's writes, not the whole database. No schema changes are required for this phase.

The required apps/packages/infrastructure directories are reserved for future extraction; application code stays in src to avoid an unrelated monorepo migration.

## Implementation and validation

- [ ] Merchant checkout URL and Paddle.js page, scoped CSP and tests.
- [ ] Paid-status correction, renewal enrollment validation, transient processing retry.
- [ ] Serialize account grant/refund/status writes.
- [ ] Prompt webhook acknowledgement and frequent fallback schedule.
- [ ] Align documented contracts and configuration.
- [ ] Targeted unit/route/UI tests, type check, lint, build.

## Remaining release work

- [ ] Disposable PostgreSQL migration/concurrency/rollback evidence.
- [ ] Real sandbox checkout, renewal, recovery, cancel, refund/dispute and mobile/browser E2E.
- [ ] Payment methods account inventory; UPI mandate/deferred-payment scenarios.
- [ ] Live catalog/credentials/webhook configuration verification and release approval.
- [ ] Unified regional display/quote pricing, billing-country recovery, discounts/credits/trials/plan-change decisions.
- [ ] Payment-method update, invoices/history and lifecycle notifications.
- [ ] Resubscription after cancellation, cancellation persistence failures/concurrency and deletion races.
- [ ] Partial/cumulative refund and dispute-reversal policy, retention and Cashfree closeout.
- [ ] Durable checkout recovery after refresh; complete accessibility/offline/rate-limit/error states.
- [ ] Distributed payment rate limits, request bounds, CSRF review and operational alerts/review tooling.
- [ ] Queue throughput/load evidence, observability, dependency/security checks and deployment/rollback runbooks.

Never interpret mocked tests as external-provider or production database verification.
