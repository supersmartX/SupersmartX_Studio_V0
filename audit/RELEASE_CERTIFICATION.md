# SUPERSMARTX RELEASE CERTIFICATION

```text
SUPERSMARTX RELEASE CERTIFICATION

CODE ACCEPTANCE
----------------
Build: PASS (29/29 pages, Next 16.3.6)
TypeScript: PASS
Lint: PASS (0 errors, 19 warnings)
Tests: PASS (834/834, 56 files; baseline 800/800 + 34 new on 2026-10-01)
Real MP4: PASS (28/28 destinations × source aspects, `npm run test:mp4`)
DB durability: PASS (production fails closed; 28 new tests)
P0: 0 open (3 critical defects found and fixed: 2026-09-30 x2, 2026-10-01)
P1: 0 open

DEFECTS FOUND AND FIXED (2026-09-30 state-machine pass)
------------------------------------------------------
The 2026-09-22 report recorded "no genuine defect was found". That is no
longer accurate. Seven were found; three were critical. Details in
CHANGELOG.md.

1. CRITICAL — duplicate payment events could re-extend a subscription
   (cashfree-fulfillment: the notification claim was taken outside the try,
   so a ledger failure released the fulfilment claim and a retry re-granted
   time from `now`). Now covered by fault-injection regression.
2. CRITICAL — "Open My Library" deleted the master recording, breaking
   restore-after-reload, sign-in and upgrade.
3. CRITICAL (2026-10-01) — the DB driver fell back to a local file, and then
   to `:memory:`, when no Turso URL was configured. In production that meant
   a fresh empty database per serverless instance: webhook dedupe ledgers,
   subscription state and library metadata all silently non-durable, which
   defeats the payment idempotency fix in (1). Production now fails closed
   (`DatabaseNotConfiguredError`) unless a remote libsql/https URL and an
   auth token are both present. Dev/test fallbacks are unchanged.
   Covers the P2 risk previously listed as "not yet dispositioned".
4. Landscape exports were never actually measured by the MP4 gate
   (`findEdges` returned NaN), so 16:9 could not fail.
5. No browser capability gate: an encoder-less browser hung at
   "Exporting... 0%" forever, because the failure is a hang, not a throw.
6. `export-lifecycle` could not reach the failure it was written to test
   (stale duplicate `ensureStudioReady` never re-acquired the camera).
7. The R2 gate read `.env.local` placeholders as credentials and hung 4
   minutes instead of skipping.

Audited on 2026-10-01 and found clean, with no code change required:
payment webhook idempotency, master-recording survival across nav/auth/
OAuth/upgrade/reload/export failure/cancel/retry, the export capability gate
ordering (it runs before the server job is created, so an unsupported
browser spends no row, quota or concurrency slot), and the Free/Creator
entitlement matrix. Real-MP4 re-verified 28/28 this pass.

These are code-level fixes with tests. They do not clear any live-evidence
blocker below.

PRODUCTION VALIDATION (2026-09-22, live probes + honest gaps)
---------------------
Authentication: PARTIAL (401 gates, anti-enumeration, bogus-token
  rejection, health-DB all PASS live; login/logout/signup/session/
  cookies NOT VERIFIED — no test account)
OAuth: NOT VERIFIED (needs interactive flow + test identity)
Database: PARTIAL (prod connection + migrations PASS via /api/health;
  write/lifecycle/cleanup NOT VERIFIED — destructive, needs test accounts)
R2: NOT VERIFIED (needs test-account export + storage inspection)
Signed URLs: NOT VERIFIED (needs session + TTL observation)
Authorization: PARTIAL (cross-user live test open; source + unit PASS)
Entitlements: NOT VERIFIED live (unit-tested; needs plan test accounts)
Cashfree: NOT VERIFIED (no-sig webhook 400 PASS; full flow needs sandbox)
Cron: NOT VERIFIED (needs Vercel logs + owner approval)
Email: NOT VERIFIED (needs mailbox + provider dashboard)
Domain: PASS (HTTPS, canonical, apex/www redirects, HSTS)
Observability: NOT VERIFIED (needs log access; code-verified clean)
Rollback: PARTIAL (procedure documented; drill + prev-good open)

BROWSER MATRIX (2026-09-30, Playwright)
--------------------------------------
Chromium: PASS — 125 passed / 3 skipped
Mobile (Pixel 5): 116 passed / 3 skipped / 9 FAILED — all 9 are one
  pre-existing harness-scoping defect, not 9 product defects. Verified
  pre-existing on 2026-10-01 by reverting every change of this pass and
  reproducing the identical failures. Root cause: the landing header CTA
  wrapper is `display: none` below the mobile breakpoint, and
  `auth.spec.ts`, `landing.spec.ts` and `edge-cases.spec.ts` each do
  `goto('/')` + click `button[name="Log in"]` without opening the burger
  menu, so the target is absent from the accessibility tree at Pixel 5.
  The product path is correct and was proven live: a temporary probe
  (since removed) opened the burger, clicked the mobile-menu "Log in" and
  the auth dialog opened — as does the passing "mobile menu toggles
  correctly" test. Not fixed here: making the specs viewport-aware is a
  harness change, and no product code should be bent to satisfy it. Tracked
  as blocker 12.
Firefox: FAIL (harness) — 60 passed / 7 skipped / 59 failed, of which 57
  are `Unknown permission: camera` and 2 are dev-server contention from
  running two projects at once. Two genuine candidates remain untriaged:
  Escape does not dismiss a modal, and a hero overlay intercepts clicks on
  the footer legal links. Both pass on chromium.
Safari/WebKit: NOT VERIFIED — binary installed, no project configured.
2 pricing tests self-skip when the pricing button is absent, so they can
pass without asserting anything.

STATUS:
LOCAL RELEASE CANDIDATE - CODE CERTIFICATION COMPLETE;
PRODUCTION CERTIFICATION BLOCKED BY LIVE EVIDENCE.
(Certification remains BLOCKED - see BLOCKERS.)

MASTER-RECORDING GUARANTEE (what is actually promised)
---------------------------------------------------
The master take is preserved across: free use -> authentication -> upgrade
-> payment -> reload -> navigation -> export (success, failure, retry,
cancel, unsupported browser). Proven locally by 6 new tests plus
`e2e/p0-upgrade-preserves-recording.spec.ts`; production proof is runbook
Test 10 (PV-GOLDEN), which is the only test that observes the guarantee.

It is device-local IndexedDB only (`sxs-studio`, store `recordings`) with a
24h retention window. It is NOT a server-side backup. It does not survive a
cleared browser profile, a private window, a different device or browser, or
the 24h window. No user-facing copy, onboarding text or marketing may imply
"your recording can never be lost" - that claim is unsupported. Server-side
master backup would be a product/storage change and is deliberately out of
scope for this certification.

BLOCKERS: (cleared by runbook test in brackets)
1. OAuth end-to-end flow (new + existing user, failure paths) [Test 2]
2. R2 privacy + unauthorized + cross-user access with test accounts [Test 4]
3. Signed-URL lifecycle (issue → download → expiry) + export-ID tamper
   [Test 5]
4. Live entitlement matrix (free vs creator, normal + tampered requests)
   [Test 6]
5. Cashfree sandbox end-to-end (initiation, success, failure, webhook
   verify/dedupe/reject, entitlement update) [Test 7 + Test 10 steps 5-7]
6. Cron execution evidence (logs, auth, cleanup, FK consistency) [Test 8]
7. Email delivery evidence (reset + transactional) [Test 9]
8. Production env audit (names YES/NO, values never printed) [Test 9.4]
9. Authenticated session behaviors (login/logout/persistence/expiry/cookies)
   [Test 1]

BLOCKERS ADDED BY THE 2026-09-30 PASS:
10. Firefox E2E cannot run the camera specs (`permissions: ['camera']`
    unsupported) — 57 failures hide the real Firefox signal. Requires owner
    decision: Test 10 has the browser-decision checklist in §13 of the
    runbook. [Browser decision §13]
11. Safari/WebKit unverified, so the "try Chrome or Edge" guidance in the
    new export gate has no Safari-side evidence behind it. [Browser decision §13]
12. (2026-10-01) Nine mobile-chrome specs click a desktop-only "Log in"
    CTA that is `display: none` at the Pixel 5 breakpoint, so the
    mobile auth path has no automated coverage. Proven working by hand; the
    specs need to open the burger menu on narrow viewports. Not a product
    defect. [Harness]

NOT VERIFIED:
See BLOCKERS + audit/PRODUCTION_VALIDATION_RESULTS.md (each row names its
required procedure). Nothing was marked PASS without live evidence.

KNOWN P2 RISKS:
- In-memory rate limiter not distributed (Redis before 10k users)
- Cashfree FK-OFF last-resort fallback: monitor order/webhook mismatch
(audit/REMAINING_RISKS.md)
- RESOLVED 2026-10-01: `lib/db/driver.ts` could fall back to `:memory:`
  when persistence was unavailable, breaking durable payment idempotency
  and library metadata. Production now fails closed instead. Dev/test
  fallback intentionally retained.
- Webhook reconciliation cron still absent, so a Cashfree event that never
  reaches the endpoint is only recovered when the buyer returns to
  `/api/cashfree/verify`. Blocked on owner access, not on code.

EVIDENCE:
- audit/OWNER_PRODUCTION_CERTIFICATION_RUNBOOK.md (owner session, Tests 0–9)
- audit/PRODUCTION_VALIDATION_RESULTS.md (live probe evidence, 2026-09-22)
- audit/ACCEPTANCE_MATRIX.md (source-level PASS record, Gates A–H)
- audit/ACCEPTANCE_REPORT.md, CHANGELOG.md, BASELINE.md
- Live PASS summary: /api/health 200 healthy; /api/exports + /api/download
  401 anon; forgot-password unknown 200 {"ok":true}; reset bogus 400;
  webhook unsigned 400; apex→studio 308 chain; full security-header set.
```

Certification remains BLOCKED. The 2026-09-30 pass closed no live-evidence
blocker — it found and fixed real defects and raised local coverage, but
blockers 1–9 all need an owner session with provider access, and 10–11 need
harness work. Each BLOCKER clears only with recorded live evidence, at which
point this file is updated to CERTIFIED.

2026-10-01 PASS: same conclusion, plus one more critical defect fixed (DB
driver fall-back, above) and one more harness issue recorded (blocker 12).
Local re-run: tsc PASS, eslint PASS (0 errors / 19 warnings, unchanged),
build PASS, vitest 834/834, real MP4 28/28, chromium 125 passed,
mobile-chrome 116 passed / 9 pre-existing harness failures. The mobile
suite is no longer marked PASS; the mobile auth path is correct but
untested by automation, which is what blocker 12 now tracks. No live-
evidence blocker moved, and nothing here is production-certified.
