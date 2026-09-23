# SECURITY AUDIT (Due Diligence)

Method: source inspection of auth, all 24 API routes (11 deep-read this
pass, remainder from acceptance phase), R2 layer, crypto usage (bcryptjs
verified live: `COMPARE_RESULT:false` on OAuth stub — fail-closed), git
history + secret-pattern scan (values never reproduced), live probes
(401 gates, 400 fail-closed paths). Severity per §20 definitions.

## Verdicts

- No P0. No anonymous exploit path to user data, no committed secrets, no
  injection/SSRF/RCE surface (`exec/spawn`: zero hits in src; server
  fetches: fixed Cashfree/Resend/Discord-env URLs only; geo-IP is
  client-side).
- Two P1s, both authenticated-abuse/cost class (FINDINGS SEC-001, BUS-001).

## Findings (full format)

ID: SEC-001 | Category: security | Severity: P1 | Confidence: confirmed
Title: Presigned-upload size cap enforced against client claim, not
server-verified object size
Location: src/app/api/exports/complete/route.ts:38 vs :60-67
Evidence: line 38 rejects only client `fileSize` > 200MB; lines 60-67 fetch
HeadObject, compute `verifiedSize`, store it — with no cap check and an
empty content-type branch (:68-70). Multipart path is safe (real file.size).
Risk: unbounded object size + unbounded creator storage (plan ceiling null).
Failure/Attack Scenario: paid creator PUTs 5GB via signed URL, completes
with `fileSize: 1` → stored, counted, downloadable. Impact: R2 cost,
quota-accounting corruption. Fix: 413 on verifiedSize > MAX + delete
object + regression test (mock headObject). Effort: Small. Regression: Low.

ID: BUS-001 (in BUSINESS_LOGIC_AUDIT.md — cross-listed P1, client-attested
duration budget; localStorage daily ledger + client durationParam; complete
ignores duration entirely).

ID: SEC-002 | P2 | confirmed — Production auth on next-auth beta line
(package.json ^5.0.0-beta.32, installed 5.0.0-beta.32, ISC, not deprecated).
Risk: breaking changes / patch latency on the auth path. Fix: pin exact,
track Auth.js, migrate on stable. Effort: Large. Regression: Medium.

ID: SEC-003 | P2 | confirmed — Classic PAT embedded in LOCAL git remote URL
(origin github.com/supersmartX/*; not repo content; value redacted).
Risk: push-access via maintainer-machine exposure. Fix: rotate now, `gh
auth`, audit scopes/keys. Effort: Small. Regression: None.

ID: SEC-004 | P2 | requires-verification — R2 bucket privacy is
console-side; code is clean (signed URLs only, owner-namespaced keys,
no public-URL construction in src). Fix: verify private + recurring
negative-access probe. Effort: Small.

ID: SEC-005 | P3 | confirmed — No email verification (auth.ts:70-78;
no verify route/table). Low exploitability (reset goes to true owner).
Fix: verification gate or accepted-risk record. Effort: Medium.

ID: SEC-006 | P3 | confirmed — Per-email lockout enables targeted lockout
DoS; forgot/reset IP keys use spoofable x-forwarded-for + in-memory maps.
Fix: Redis limiter, CAPTCHA/backoff. Effort: Small (with OPS-002).

ID: SEC-007 | P3 | confirmed — Webhook HMAC has no timestamp window
(webhook/route.ts:13-35); replay bounded by processed_webhooks dedupe +
amount re-check. Fix: 5-min freshness window. Effort: Small.

ID: SEC-008 | P3 | confirmed — Gravatar SHA-256(email) disclosure
(user-store.ts:48-51); client geo-IP (pricing.ts:113-142); fonts/Cashfree
SDK in CSP. Fix: opt-in avatars, privacy register. Effort: Small.

ID: SEC-009 | P3 | confirmed — 30d sliding JWT (auth.config.ts:24-26),
no MFA code in src, trustHost: true (:27). Mitigated by sessionVersion
kill-switch. Fix: 7d maxAge, TOTP for paid, explicit host. Effort: Medium.

## Controls verified working (do not regress)

bcrypt cost 12; 5-fail/15-min lockout; sha256 single-use expiring reset
tokens (DELETE…RETURNING); sessionVersion invalidation; OAuth stub
fail-closed; ownership-scoped queries on every resource route (404, no
oracle); key-prefix + traversal checks; sanitized errorMessage/feedback/
email HTML (sanitizeHtml); generic error surfaces; HSTS/CSP/DENY/nosniff
live; `__Secure-` lax httpOnly cookies; Auth.js CSRF on its own endpoints;
mutations are POST/PATCH/DELETE (Lax-protected).
