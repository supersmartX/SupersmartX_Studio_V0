# OBSERVABILITY AUDIT

Present: structured JSON logger (request-id, hashed user ids, PII-safe
fields), x-request-id on all API responses, client-error ingestion with
PII-avoidance, health endpoint (now with commit traceability), optional
Discord webhook, generic error surfaces. Log hygiene verified — no
password/token/key/secret/URL/PII logging found in src.

## Blind spots (OBS-001, P2)

- No APM (no Sentry/Datadog/New Relic code or config).
- No uptime synthetics (health exists but nothing polls it).
- No funnel dashboards (payment drop-off, encode-failure rate, R2 errors
  are log-grep exercises).
- No alerting paths except optional Discord; no on-call rotation artifact.
- Client-error ingestion unauthenticated + unthrottled (API-002) — the one
  telemetry source is also the least trustworthy under abuse.
- No request sampling/retention policy; Vercel log retention limits
  unexamined.

## Verdict

Failures are diagnosable by an engineer with log access (good hygiene,
correlation ids) but not DETECTABLE without one. MTTD is the liability.
Roadmap Phase 1: error tracking + uptime + funnel alerts (medium effort).
