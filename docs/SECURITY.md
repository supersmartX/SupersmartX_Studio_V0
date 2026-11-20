# Payment implementation security review

Identified risks: incorrect payment status acceptance, renewal attribution mismatch, concurrent entitlement writes, checkout URL trust, delayed webhook acknowledgement, missing distributed rate limits and incomplete recovery. Browser redirects and callbacks must never grant access. Verify signatures over the raw body; authenticate customer APIs; compare resource ownership server-side. Merchant checkout URLs require an exact configured HTTPS origin/path, with no credentials or fragments. Public client tokens are distinct from server API secrets. Keep live mutation gates closed during this work.

Use parameterized per-user database row locks for billing projection mutations. Retain durable event IDs, transaction claims and lease fencing. No production database or provider mutations are part of local verification. Release security checks include CSRF, request limits, dependency scans, secret isolation and retention review.
