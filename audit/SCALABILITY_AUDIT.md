# SCALABILITY AUDIT

Model (reasoned from architecture; no load-test data exists — running them
is roadmap Phase 3).

| Users | Verdict |
| ----- | ------- |
| 100 | Comfortable. SQLite file or small Turso; serverless concurrency ample. |
| 1,000 | Comfortable with Redis limiter (OPS-002) + observe throttle (API-002). R2 + Turso fine. |
| 10,000 | WALL: serverless multipart uploads (SCALE-001) must move to presigned-only; browser-encode exclusion visible in support load; cleanup needs LIMIT/batching; lists need pagination; logs-only ops breaks triage (OBS-001). |
| 100,000 | Requires: server encode queue (paid fallback), read-replica/caching strategy for exports/stats, APM + funnel dashboards, abuse/cost alerting (COST-001/002), email deliverability (dedicated IP/domain warmup). |
| 1,000,000 | Requires: multi-region storage/CDN for downloads, encode fleet autoscaling, data-partitioning review, dedicated data/ML-abuse teams. Out of current architecture scope — plan, don't build. |

## Component futures

- DB: libSQL/Turso to ~10k actives on atomic-UPDATE patterns; beyond that,
  split hot counters (Redis) from system-of-record, add read replicas.
- API: stateless + thin — scales horizontally; only upload proxy and
  limiters need rework.
- Auth: JWT-stateless scales; lockout/limiter rows need Redis (OPS-002).
- R2: data-plane scales; cost controls don't (COST-001/002).
- Encoding: client-side scales infinitely in server cost, zero in
  device coverage — the fundamental tradeoff (see PERFORMANCE_AUDIT.md).
- Queues: none exist; first needed queue is server-encode fallback.
- Rate limits/infra caps: Vercel + Turso plan ceilings must be modeled
  with real traffic (account-level, not code).

## Finding: SCALE-001 (P2) — upload proxy + browser-only encode (FINDINGS.json).
