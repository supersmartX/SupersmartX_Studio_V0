# PERFORMANCE AUDIT

Evidence: .next/static/chunks (17 files, 1423.7KB; largest 528.6KB),
zero next/dynamic in src, DB index review, route query review, live
health latency (normal). No APM data exists (OBS-001) — all conclusions
are structural, labeled as such.

## Current bottlenecks (structural, confirmed present)

1. Frontend bundle: no code-splitting; 528KB largest chunk on the
   record/export path (PERF-001, P2). Mid-tier mobile TTI suffers.
2. 816-line studio orchestrator re-renders via prop-drilled state; no
   memoization strategy evidenced (ARCH-001 feeds this).
3. Multipart uploads buffer 200MB through serverless functions (SCALE-001).

## 10x bottlenecks (reasoned, not measured)

- Serverless upload proxy: payload/timeout walls, transfer cost.
- Exports list (LIMIT 100, no pagination) + R2 single-page listing.
- Unbounded cleanup reads (API-002) become minute-long cron runs.
- SQLite single-writer contention on Turso under concurrent completes
  (atomic UPDATEs hold the write lock briefly — fine to ~1k concurrent,
  then queueing).

## 100x bottlenecks

- Browser-only encode (no server fallback) excludes weak devices entirely.
- Per-isolate rate limiting is decorative at this scale (OPS-002).
- Logs-only observability cannot triage at volume (OBS-001).

## Video-processing note (largest cost/compute lever)

Encode is client-side: server compute cost is ~zero and R2 transfer is the
only variable cost per export — favorable unit economics, paid for in
device-exclusion and zero server-side duration/size verification (which is
exactly what enables SEC-001/BUS-001). Any server-encode fallback flips
this tradeoff and must be cost-modeled first (see SCALABILITY_AUDIT.md).
