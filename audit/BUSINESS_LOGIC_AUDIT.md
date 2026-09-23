# BUSINESS LOGIC AUDIT

Source of truth: src/lib/entitlements.ts (free vs creator_monthly/yearly;
pro_* legacy-only) + src/lib/pricing.ts (server prices, geo-resolved).

| Capability | Plan | UI | API | DB | Result |
| ---------- | ---- | -- | --- | -- | ------ |
| Resolution cap (720p/1080p) | free/creator | clamped display | presigned-put clamps via preset; export-upload clamps custom | stored dims client-reported (DB-001) | ENFORCED (upload path secure; metadata weak) |
| Duration budget 600s/d | free | localStorage meter | client durationParam checked; complete ignores duration | no seconds ledger | BYPASSABLE — BUS-001 (P1) |
| Platform lock (YT-only free) | free | picker gating | all 3 upload paths reject locked platforms | n/a | ENFORCED |
| Crop permission | free | hidden | presigned + multipart reject; complete n/a (encode-side) | n/a | ENFORCED where stateful |
| Upload count 3 / storage 500MB free | free | messaging | atomic check+increment | user_stats | ENFORCED |
| Object size 200MB | all | presetting | multipart enforced; presigned NOT (verifiedSize) | stored unchecked | BYPASSABLE presigned — SEC-001 (P1) |
| Download entitlement/count | all | gating | plan + atomic count | user_stats | ENFORCED (count-before-sign wart DB-001) |
| Monthly export quota | — | — | machinery built | table built | DORMANT all plans null — DB-003 (P3) |
| Price/amount | buyer | display | server geo price; webhook re-verifies vs pending_orders | pending_orders | ENFORCED |
| Plan derivation | all | display | DB row + isPlanActive (paid w/o expiry fails closed) | users.plan | ENFORCED, tested |

## Bypass attempts (per §5 matrix)

- Forged plan string → falls back to free (tested). Modified user ID →
  server uses session id everywhere (no route trusts client id). Modified
  export ID → 404 ownership scope (no oracle). Replayed complete →
  idempotent same-key success / 409. Modified resolution → clamped
  (presigned) — EXCEPT stored metadata (P3). Modified duration → ACCEPTED
  (P1 BUS-001). Under-reported fileSize on presigned → ACCEPTED (P1
  SEC-001). Forged platformId on export-jobs POST → stored opaque, blocked
  later at complete (P3 API-001).

## Finding (full format)

ID: BUS-001 | Category: business-logic | Severity: P1 | Confidence: confirmed
Title: Recording-duration budget is client-attested end-to-end
Location: src/lib/daily-recording.ts:17-64; export-upload/route.ts:159-171;
complete/route.ts (absent)
Evidence: daily ledger in localStorage (cleared = reset); server checks a
client-sent `duration` string; presigned-complete path never sees duration;
no DB seconds ledger exists. Risk: free 600s/day pricing control bypassable
at zero cost. Scenario: clear site data + `duration: 10` on a 30-min upload
(within 200MB) → accepted. Impact: quota integrity loss (bounded by size/
count caps); pricing-model erosion at scale. Fix: server-side seconds
ledger incremented atomically at complete (parse duration server-side or
accumulate reported-then-verified); client meter becomes hint. Effort:
Medium. Regression: Low (additive counter + tests).
