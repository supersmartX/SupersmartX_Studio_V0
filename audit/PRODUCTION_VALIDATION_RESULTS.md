# SUPERSMARTX — PRODUCTION VALIDATION RESULTS

Date executed: 2026-09-22 ~21:37–21:50 UTC.
Target: `https://studio.supersmartx.com` (Vercel; `Server: Vercel` observed).
Method: unauthenticated HTTPS probes only — no test accounts, credentials,
payments, writes, or log access exist in this environment. No credentials,
tokens, or secrets were used, logged, or stored. No response below contains
private user data.

## CODE VERIFIED vs PRODUCTION VERIFIED

- CODE VERIFIED (source + 410 automated tests): authn/authz logic,
  server-authoritative entitlements, ownership scoping, quota atomicity,
  FK constraints (v10), idempotent complete/webhook, error sanitization.
  Recorded in `audit/ACCEPTANCE_MATRIX.md` — all PASS at source level.
- PRODUCTION VERIFIED (this file): ONLY the rows marked PASS below, each
  with live evidence. Nothing else was converted.

## Results

| System | Test | Expected | Actual | Status | Evidence |
| ------ | ---- | -------- | ------ | ------ | -------- |
| Authentication | Unauthenticated API access rejected | 401 | 401 | PASS | `GET /api/exports` → 401; `GET /api/download?exportId=abc` → 401 (2026-09-22) |
| Authentication | Login | Success | — | NOT VERIFIED | No test account/credentials in this environment. Procedure: create dedicated validation account, log in via prod UI, confirm session. |
| Authentication | Logout | Session invalidated | — | NOT VERIFIED | Same as above; then logout and confirm old JWT rejected. |
| Authentication | Signup | Success | — | NOT VERIFIED | Requires disposable email; verify user row + welcome state. |
| Authentication | Session persistence / expiration | Persists then expires | — | NOT VERIFIED | Requires authenticated session observation. |
| Authentication | Password reset (real account) | Email → token → reset → old sessions killed | — | NOT VERIFIED | Requires mailbox access + test account. |
| Authentication | Reset enumeration resistance | Generic success for unknown email | 200 `{"ok":true}` | PASS | `POST /api/auth/forgot-password` with nonexistent `…@example.invalid` → 200 `{"ok":true}`; no user-oracle. Side-effect free (early return before DB/email). |
| Authentication | Bogus reset token rejected | 4xx, no reset | 400 | PASS | `POST /api/auth/reset-password` with bogus token → 400. |
| Authentication | Secure cookies / prod domain behavior | `__Secure-` prefix, Secure/HttpOnly | — | NOT VERIFIED | Requires login + Set-Cookie header inspection. |
| OAuth | Full sign-in flow | Provider → callback → session | — | NOT VERIFIED | Requires interactive browser + Google test identity. Procedure §4 of program. |
| OAuth | Failure/cancel/bad-callback/existing/new user | Handled, no crash/leak | — | NOT VERIFIED | Same as above. |
| Database | Connection + migration state | healthy | 200 `{"status":"healthy","timestamp":"…","version":"unknown"}` | PASS | `GET /api/health` → 200 healthy proves `ensureMigrated()` + `SELECT 1` succeeded against the production database (non-destructive read). |
| Database | Read/write, FK enforcement on prod data, user/export/job lifecycle, cleanup | Success | — | NOT VERIFIED | Destructive by nature — MUST use disposable test accounts + direct DB access; not run from here. Verify `schema_meta = 10` on prod clone. |
| R2 | Upload | Private object, owned key | — | NOT VERIFIED | Requires test-account export + storage inspection. |
| R2 | Unauthorized access | REJECTED | — | NOT VERIFIED | Requires negative-access test with owned key but no auth. |
| R2 | Cross-user access (A export, B attempts) | MUST BE REJECTED | — | NOT VERIFIED | Requires two dedicated test accounts. |
| Download | Owner download + URL expiry | Success then expiry | — | NOT VERIFIED | Requires authenticated session + waiting out TTL. |
| Download | Altered export ID (other user's) | Rejected (404, no oracle) | — | NOT VERIFIED | Requires two test accounts. Code-verified only. |
| Entitlement | Restricted export normal + tampered | Rejected server-side | — | NOT VERIFIED | Requires free + creator test accounts; replay tampered `platformId`/resolution/duration/crop. Unit-tested only. |
| Cashfree | Initiation → payment → webhook → entitlement | Verified end-to-end | — | NOT VERIFIED | Requires sandbox/test mechanism + provider dashboard; no real-money transactions performed. |
| Cashfree | Failed payment / bad signature / duplicate webhook | Rejected / deduped | — (see note) | NOT VERIFIED | Note: `POST /api/cashfree/webhook` with NO signature → 400 live (fail-closed), but full matrix needs provider-side tests. |
| Cron | Scheduled execution + auth + cleanup + FK | Executes, cleans, stays consistent | — | NOT VERIFIED | Requires Vercel cron logs + `CLEANUP_SECRET`; do not trigger manually without owner approval. |
| Email | Reset + transactional + sender + failure | Delivered, correct domain | — | NOT VERIFIED | Requires mailbox + Resend dashboard access. |
| Environment | Variables configured + used correctly | YES/YES, values never printed | — | NOT VERIFIED | Cannot audit Vercel env from here. Procedure: dashboard audit of all names in `docs/ENVIRONMENT.md`; report YES/NO only. |
| Domain | HTTPS + canonical + redirects | studio canonical, apex/www redirect | All observed | PASS | `http://supersmartx.com/` → 308 `https://supersmartx.com/`; `https://supersmartx.com/` → 308 `https://studio.supersmartx.com/`; `https://studio.supersmartx.com/` → 200. HSTS `max-age=63072000; includeSubDomains; preload` present. |
| Domain | OAuth callbacks, cookie domain, CORS, webhook origin | Correct | — | NOT VERIFIED | Requires provider console + authenticated flows. |
| Observability | Events visible; no secret/PII logging | Hashed ids, generic errors | — | NOT VERIFIED | Requires log/monitoring access. Code-verified: hashed user ids, redacted secrets, generic surfaces. |
| Rollback | Capability documented, previous-good known | Documented + drillable | Procedure documented; drill open | PARTIAL | `docs/ROLLBACK.md` verified in repo; previous-good deployment identity + restore drill require Vercel access. No destructive rollback executed (correctly). |
| Headers | Security headers on pages + API | CSP/HSTS/frame/MIME/referrer/permissions | All present | PASS | `/` and `/api/health` return CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, strict referrer, camera/mic-only permissions policy. `x-request-id` present on API (by design `/api/*` only). |
| Webhook | Missing signature | 400, no processing | 400 | PASS | `POST /api/cashfree/webhook` `{}` without signature headers → 400. |
| Health | Anonymous response hides internals | No `checks` field | Confirmed | PASS | Anon body has only `status/timestamp/version`; detailed `checks` require session (source: `health/route.ts:30-36`). |

## Observations (not defects)

1. Health reports `"version":"unknown"` — expected: `npm_package_version`
   is unset on Vercel. Deploy traceability therefore depends on the Vercel
   dashboard/deployment list, not the health endpoint. Consider stamping a
   build SHA into health output in a future change (not done here — no code
   changes per program rule).
2. `x-request-id` is stamped on `/api/*` only (middleware matcher), not on
   pages — by design; page errors correlate via client-error ingestion.

## Test-account policy compliance

No production test accounts, exports, payments, or emails were created —
none exist in this environment. All NOT VERIFIED rows above name the
dedicated-account procedure the owner must run. No test artifacts to clean.
