# Billing information architecture

Studio account menu -> pricing -> payment page (maximum three levels). Pricing presents a signed quote; payment opens provider checkout; return to Studio shows server-owned access. Payment page purpose: resume the existing transaction, never create another purchase. Actions: reopen checkout, return to Studio. States: unavailable configuration, loading, open, closed, error, payment awaiting verification. Existing account menu owns subscription status and cancellation. Invoice and payment-method navigation remain open work.
