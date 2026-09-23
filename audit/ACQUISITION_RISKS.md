# ACQUISITION RISKS (Register)

P0 — deal blockers: NONE confirmed. (No exposed prod credentials in repo/
history; no anonymous data access; no unrecoverable integrity flaw.)

## P1 — must fix pre-ownership (2)

- SEC-001 Presigned size-cap bypass → unbounded paid-account storage/cost.
- BUS-001 Client-attested duration budget → pricing-control bypass.

## P2 — price into the deal / fix pre- or just-post-close (13)

Security: beta auth line (SEC-002), local PAT hygiene (SEC-003),
R2 privacy verification (SEC-004). Architecture: God components (ARCH-001).
Operations: backups/RPO (OPS-001), in-memory limits (OPS-002), no APM/uptime
(OBS-001), branch/env isolation unverified (INFRA-001). Product-readiness:
API-level test gap (TEST-001). Scale/cost: bundle (PERF-001), upload path
(SCALE-001), creator storage ceiling + egress (COST-001/002).

## P3 — scheduled hardening (20)

Auth hardening bundle (SEC-005 email verify, SEC-006 lockout keys, SEC-007
webhook window, SEC-008 privacy, SEC-009 sessions/MFA), API caps (API-001/
002/003), DB retention/metadata/dormant path (DB-001/002/003), content-type
(STO-001), frontend a11y/store (FE-001/002), lint/dead-code/duplication/
bloat (QUAL-001..004), API reference (DOC-001), health deploy pending
(DEP-001).

## Non-risks explicitly cleared (acquirer FAQ)

- Secrets in repo/history: none found (shapes verified, values never
  reproduced; recommend gitleaks pre-close for completeness).
- IDOR/privilege escalation in reviewed routes: none found; ownership
  scoping uniform + tested.
- Injection/XSS/SSRF/RCE: no exec, no dynamic SQL, sanitized HTML paths,
  fixed-URL server fetches; dangerouslySetInnerHTML limited to static
  CSS/SEO/loader script.
- Data loss on delete flows: FK + CASCADE/SET NULL + idempotent sweeps,
  tested.
- License contamination: no GPL/AGPL; MPL-2.0 consumed unmodified
  (counsel confirm).
- Payments integrity: HMAC + re-fetch + amount check + idempotent
  activation — sound.
