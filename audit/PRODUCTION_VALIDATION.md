# Production Environment Validation (NOT verifiable from source)

Status: NOT VERIFIED — each item requires the deployed production/staging
environment. Do not mark PASS without executing the check against prod.

## Auth & sessions

- [ ] Google OAuth round-trip (consent → stub-user creation → session)
- [ ] Session cookie flags in prod (`__Secure-` prefix, Secure/HttpOnly/SameSite)
- [ ] Password-reset email delivery → token → session invalidation everywhere

## Payments (Cashfree, sandbox then prod)

- [ ] Order creation with real geo headers (no client-country arbitrage)
- [ ] Webhook delivery + signature verification end-to-end
- [ ] Amount/currency mismatch rejection with a tampered order
- [ ] Plan activation + expiry downgrade to free

## Storage (R2)

- [ ] Bucket is private (anonymous GET denied for an object key)
- [ ] Presigned PUT upload succeeds with issued URL; tampered key rejected
- [ ] Signed download URL works, then 403s after expiry
- [ ] Cross-user key access impossible (user B cannot use user A's URL/key)

## Data & infra

- [ ] Turso connectivity from serverless (no `:memory:` fallback in logs)
- [ ] v10 migration on a production-data clone (row counts preserved)
- [ ] Nightly cleanup cron fires with valid `CLEANUP_SECRET`
- [ ] Resend email delivery (payment receipt, admin notification)
- [ ] Domain: apex/www → studio redirect, HSTS, CSP without console violations
- [ ] Rate limiting behavior under load; plan Redis-backed limiter threshold

## Performance

- [ ] Studio first-load JS / LCP on mid-tier mobile
- [ ] Long-recording encode time/memory ceiling in real browsers
- [ ] Export list latency at 100+ exports/user
