# Billing flows

Entry: authenticated pricing selection -> signed quote -> durable reservation -> Paddle transaction -> approved payment URL -> provider checkout -> signed webhook -> durable inbox -> leased worker -> atomic entitlement.

Exit: return to Studio. Failure: keep transaction/reservation identity and offer resume; do not blindly recreate. Recovery: ownership-checked status lookup and authoritative provider reconciliation.

Renewal: provider-generated transaction -> verified original enrollment and subscription/customer ownership -> paid period ledger. Pending processing retries; invoice issuance does not activate access. Cancellation retains paid-through coverage. Refunds recompute coverage under the same per-user lock as grants.
