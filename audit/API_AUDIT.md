# API AUDIT

24 route files. All protected routes follow
auth()→findUserById→isPlanActive→entitlement→ownership-scope; errors generic;
request-ids stamped. Per-endpoint cards for the 11 routes deep-read this
pass below; remaining 13 (auth [...nextauth], download, exports CRUD,
presigned-put, complete, export-upload, cashfree order, recordings,
user/delete) were evidenced in the acceptance phase and re-referenced.

- POST /api/export-jobs — 201, concurrency cap 3 (429), platform lock-checked
  but NO allowlist, opaque config blob, no throttle → API-001 (P3).
- GET /api/export-jobs — absent (404/405). No risk.
- GET /api/export-jobs/[id]/status — ownership-strong, no plan re-check
  (poll-after-expiry allowed, acceptable), no throttle (P3, API-002).
- GET /api/auth/session — Auth.js delegated. Low.
- POST /api/auth/forgot-password — anti-enumeration, 3/min/IP, sha256 token,
  1h expiry. Limiter caveats (SEC-006). Low.
- POST /api/auth/reset-password — atomic single-use consume + expiry,
  sessionVersion kill, strength rules. Low.
- POST /api/feedback — auth + 3/h + 500-char sanitize + secret-gated
  Discord forward. Low.
- POST /api/observe/client-error — PUBLIC, kind-allowlisted, truncated, no
  throttle → spam-able log writer (P3, API-002).
- GET /api/user/stats — own-row only, DB plan (not JWT). Low.
- GET /api/exports/[id]/preview — ownership + completed + non-local checks;
  fixed 3600 TTL; bearer URL (P3, API-003).
- POST /api/export-jobs/cleanup — timing-safe secret, fail-closed 401, no
  IP allowlist/rate limit; unbounded read (P3, API-002/INFRA-001).

## Cross-cutting

- Methods/status codes correct (201 create, 400/401/403/404/409/413/429/500
  used semantically; 404 preferred over 403 for foreign ids).
- No route trusts client userId/email/plan for decisions (observe `plan` is
  telemetric only — must never feed billing).
- No pagination: exports LIMIT 100, recordings single R2 page (1000),
  cleanup unbounded (API-002, P3).
- No request body byte caps; post-parse truncation only (API-002, P3).
- Idempotency: complete (same-key) + webhook (processed_webhooks) — good.
- Replay: reset-token single-use; webhook dedupe; complete 409 — good.
- CSRF: mutations are POST/PATCH/DELETE under SameSite=Lax session cookie;
  Auth.js endpoints carry their own CSRF. Assessed acceptable; no finding.

## Findings: API-001, API-002, API-003 (all P3, in FINDINGS.json).
