# Billing remediation checklist

## Completed

- [x] Server-authoritative activation with reservation, user, plan and Paddle metadata correlation.
- [x] Idempotent entitlement grants for duplicate and concurrent webhook delivery.
- [x] Checkout handoff protection and false-activation prevention.
- [x] Cancellation eligibility restricted to active subscriptions.
- [x] Automatic reconciliation of open reservations when billing status is requested.

## Remaining production verification

- [ ] Deploy the billing-status reconciliation change.
- [ ] Verify the completed Sandbox transaction `txn_01m83pm62xp38z55c0268e8xz` reconciles to Creator after deployment.
- [ ] Confirm the local billing transaction has `entitlementGrantedAt` and the user plan is Creator.
- [ ] Confirm the SupersmartX confirmation email is delivered after entitlement activation.
- [ ] Confirm Paddle webhook delivery and worker completion in provider/application logs.
- [ ] Verify logout state updates across an already-open landing-page tab.
- [ ] Run abandoned, failed, delayed-webhook, duplicate-webhook and scheduled-cancellation Sandbox scenarios.

## Safety constraints

- Never delete a completed payment or release its reservation without authoritative provider evidence.
- Never mark a transaction paid from the client or from a Paddle dashboard screenshot.
- Keep Paddle Live disabled until the Sandbox checklist is complete.
