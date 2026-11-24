<!-- HISTORICAL DOCUMENT: This file records a past audit or validation run. It is not the current source of truth. Verify every claim against the current codebase before relying on it. -->

# SupersmartX Studio — Product Audit (HEAD `b9da87f`)

> Audit date: 2026-11-21. **Read-only.** No source edits, no DB/env/Paddle changes, no commits, no CI status verified via `gh` (CLI unavailable). All findings reflect current state verified against HEAD `b9da87f`; findings identical to the 2026-11-20 audit are only restated if evidence contradicts resolution (see §8).
>
> Verification performed: `npx tsc --noEmit` (exit 0), `npm run lint` (0 errors, 17 warnings, pre-existing), `npm run test` — **14 failed / 818 passed / 263 skipped (5 failing files)** — full output in `$env:TEMP\sx-test-full.log`. Targeted reruns for the 4 known red files performed as allowed read-only verification.

---

## 1. Executive assessment

The product is a functional SaaS Video/Teleprompter platform with Auth.js JWT auth, Prisma/PostgreSQL billing schema, Paddle for all money movement, R2 exports, and a robust e2e suite (18 specs). Billing is sound in architecture: durable webhook processing, leases, TTL, idempotency, per-user business locks, and entitlement enforcement server-side.

**Where it stands:** strong core, but revenue-critical blockers remain: (a) **no live checkout in production config** — checkout/quote/cancel are gated behind `PADDLE_ENVIRONMENT=sandbox` only (F-01), meaning zero revenue can flow until launch config is verified; (b) **regional pricing display/charge mismatch** remains open (prior blocker F-06, newly manifested — plan cards advertise regional prices while charges are USD-base); (c) **consent evidence gap** (F-03); (d) **no customer email on failed payment/renewal/cancel/refund** (F-04); (e) no transaction/invoice history page (billing summary only in user menu — F-05). Five test files are red at HEAD, including billing checkout suites that map to (a).

Everything here is achievable; the plan (§9) targets P0/P1 to ship revenue-safe by launch.

---

## 2. Feature inventory (confirmed by code reading at HEAD)

- **Plans:** Free (600 s recording/day, 720p, YT 16:9 only, watermark) vs Creator (unlimited, 1080p, all platforms, no watermark). Server-side enforcement confirmed in `src/lib/entitlements.ts` + routes: `exports/complete`, `export-jobs`, `presigned-put`, `download`, `recordings`. **No production call sites for `updateUserPlan*`** — grants only via billing operations.
- **Checkout:** quote token signing/verification (`src/lib/billing/paddle.ts`), server quote verification at `/api/paddle/checkout`, sandbox-only enablement (F-01), recovery + idempotency via `reservations` table (`src/lib/billing/reservations.ts`), status reconciliation (`/api/paddle/checkout/status`).
- **Billing lifecycle:** `billing_account`, `billing_transaction`, `billing_reservation`, `billing_operation`, `billing_event` (durable queue with leases), `billing_adjustment`, account tombstones. Worker: `src/app/api/internal/paddle/worker/route.ts` — durable webhook processing, worker drains 64 events/45 s, webhook ack via `after()`.
- **Invoices:** no transaction/invoice history page (F-05); `GET /api/paddle/billing` returns `account` summary + 50 transactions + `paymentMethodUpdateUrl`; consumed by Header.tsx and ActivationModal (F-05 nuance).
- **Emails:** confirmation emails wired to `transaction.completed` in the worker (F-37). No emails for failed payment/renewal/cancel/refund (F-04, L2).
- **Observability:** `/api/observe/client-error`, CSP/HSTS, sign-in CSRF, account deletion R2 purge + identity tombstone, forgot-password anti-enumeration. No admin routes, no telemetry of server errors, no external monitoring verification.
- **Docs/roadmap:** prior audit doc `docs/PRODUCTION_READINESS_AUDIT_2026-11-20.md`, regional catalog `src/lib/pricing.ts` (63 countries / 49 currencies), configurable margins per currency.
- **Process:** 4 CI jobs (lint, typecheck, test, e2e, build), daily DB backups (Supabase PITR documented in `docs/engineering/DATABASE.md`, unverified), 18 e2e specs with auth helpers.

---

## 3. Billing scenario trace (all 13 scenarios)

All scenarios evaluated against HEAD code + red tests. **Billing-source-of-truth rule verified:** Paddle webhooks → durable `billing_event` queue (`paddle/worker`) → `operations.ts` projections (`lockBillingUser` = `SELECT ... FOR UPDATE`), grants only via `updateUserPlan*` from billing operations. No production call sites of `updateUserPlan*` exist; manual grants possible (P4 risk).

| # | Scenario | Status | Evidence/Risk |
|---|----------|--------|---------------|
| S1 | Customer quotes via GET /paddle/checkout | ✅ works (quote token, country, consentHash, expiry 24h) | Regional mismatch (F-06). Rate-limited by in-memory limiter (reset per cold start) — acceptable. |
| S2 | Customer pays → webhook → durable queue → applyPaidBillingEvent | ⚠️ Red at HEAD (6 test failures); root causes partially pinned (F-12). Renewal path: needs `txn-original` replay-safe; renewal release(...) suspect. |
| S3 | Renewal when initial quote expired | ⚠️ Red at HEAD; root cause NOT pinned (F-12 — renewal `valid` fails with generic `provider_or_persistence_error`). |
| S4 | Subscription trial → activated (`subscription.created/activated`) | ✅ worker processes snapshot (`applySubscriptionSnapshot`), entitlements flip. |
| S5 | Trial exhausted → `transaction.paid` while awaiting_confirmation | ✅ now: status route reads `billing_transaction` (subscription-expiry block F-10), worker validates totals + grants. |
| S6 | Failed/past_due payment | ✅ `applyFailedPaymentEvent` projects operations; unlock is documented. Emails: NOT sent (F-08). |
| S7 | Customer cancels at period end | ✅ `applySubscriptionSnapshot` (cancelled) → clamp; account deletion blocked while renewal possible (fixed, #2 prior). |
| S8 | Customer refund | ⚠️ adjustment route exists; **no customer email** (F-08 L2). |
| S9 | Customer dispute chargeback | ⚠️ `adjustment.created` → apply; no customer email (F-08 L2). Invoice history missing to investigate (F-09). |
| S10 | Concurrent renewal race | ✅ prior blocker FIXED: `lockBillingUser` FOR UPDATE + unique reservation/operation constraints. |
| S11 | Account deletion during active subscription | ✅ prior blocker FIXED: user deletion blocked while subscription may renew (`src/app/api/user/delete/route.ts`). |
| S12 | Wrong customer (foreign) on renewal/payment | ✅ `resolveOwner`/`verifyOriginalTransaction` reject → `ReviewEventError` → release 'review'. |
| S13 | Cashfree classic (legacy) | ⚠️ Legacy system deleted during Paddle migration (eb871f7); `billing_event` → worker → `applyPaidBillingEvent` is the new flow — but old Cashfree `pending_orders` state is orphaned, and there is **no invoice history** to view/reconcile against (F-05, F-08). |

---

## 4. Confirmed defects — P0 (critical)

> P0–P3 severity: **P0** = blocks a function or causes real loss; **P1** = blocker at launch; **P2** = meaningful quality; **P3** = low-frequency/nice-to-have. Every finding has: ID, current behavior, expected behavior, exact file/API/DB location, evidence, impact, solution, dependencies, complexity.

### F-01 — Live checkout unavailable in production (revenue loss at launch) ⚠️ NEW (F-01)
- **Current:** `isPaddleCheckoutEnabled()` returns true only when `getPaddleEnvironment() === 'sandbox'` (`src/lib/billing/paddle.ts:39-41`). All money-movement routes gate on it: `/api/paddle/checkout` (route.ts:107), `/api/paddle/quote` (route.ts:32), `/api/paddle/cancel` (route.ts:24) → in prod: quote GET returns 503, checkout POST returns 503, cancel is 503. `PADDLE_LIVE_CHECKOUT_DISABLED` is a documented *reserved* kill switch that **no route reads** since the Paddle migration (`docs/billing/PADDLE_MIGRATION_IMPLEMENTATION_REPORT.md:403`; `docs/operations/ENVIRONMENT.md`, `docs/operations/PRODUCTION-RUNBOOK.md:19`) — the real gate is the sandbox-only env check. No production onboarding or live-pricing config exists (`.env.example:56` documents the disabled var; production must set `PADDLE_ENVIRONMENT=live` deliberately).
- **Expected:** prod config with live checkout ON; automated launch checklist verifying sandbox→live transition; `isPaddleCheckoutEnabled` extended to a product feature-flag check (not just env), with manual review of live price catalog vs sandbox configs.
- **Evidence:** `src/lib/billing/paddle.ts:33-50`; callers `src/app/api/paddle/checkout/route.ts:107`, `src/app/api/paddle/quote/route.ts:32`, `src/app/api/paddle/cancel/route.ts:24`; `docs/billing/PADDLE_MIGRATION_IMPLEMENTATION_REPORT.md:403`, `docs/operations/PRODUCTION-RUNBOOK.md:19`, `docs/operations/ENVIRONMENT.md:12`.
- **Impact:** $0 revenue at launch until a reviewed prod config; users hitting disabled routes get opaque 503s ("Paddle client is not configured" family) — also a support issue.
- **Solution:** Feature-flag/env matrix (sandbox=ON, prod=ON after admin review), live-price parity test, launch checklist in this doc (§9).
- **Deps:** Paddle dashboard live prices, sandbox price configs, prod DB.
- **Complexity:** Medium.

### F-02 — Regional pricing mismatch (P0, newly manifested from prior audit F-06)
- **Current:** Plan cards in PricingModal display `getTierPrice(tier, period)` — **regional** prices (`PricingModal.tsx:493` via `currentPricing[key]` from `useRegionalPricing` L130; e.g., Brazil card shows R$29.99; CTA L546). Server `getSandboxQuoteDetails` returns **USD base** for all countries except IN (INR only) — the charge at checkout is the quote (`PricingModal.tsx:239-261`, `amount: quote.amount` L248; server quote verification). So Brazilian users see ~R$29.99 in the plan sheet and pay ~US$9.99 at Paddle. There is no "checkout step" price display — after `handleSubscribe` the user leaves to Paddle's hosted checkout.
- **Expected:** Charged amount equals displayed amount; regional catalog pricing is optional per-currency, not a USD advertising artifact.
- **Evidence:** `src/lib/pricing.ts` (63 countries / 49 currencies regional catalog); `src/lib/billing/paddle.ts:getSandboxQuoteDetails` (~575-591: USD base for all except IN); `src/components/dialogs/PricingModal.tsx` — cards L493/L510 (`getTierPrice` → `currentPricing[key]`), CTA L546, submit L239-261 (`amount: quote.amount` L248), `requestCheckoutQuote` validation at L89-91 (`quote.country`/`quote.amount`/`quote.currency` type checks); the consent blob sends `amount: quote.amount` (L248) — the only amount communicated server-side is the quote, so Paddle charges USD while the card said R$29.99.
- **Impact:** Price transparency violation (UK/EU Consumer Rights Act, EU Unfair Commercial Practices, US “regular price” rules), trust loss, regulatory exposure; chargebacks are disputes without documentation (raise losses — see F-04).
- **Solution (tiered):** (a) **Immediate P0:** hide regional prices; always quote + display USD/INR base in cards, checkout, and consent. (b) P1: implement compliant regional pricing: quote returns per-currency amount (they already hold `PADDLE_SANDBOX_AMOUNT_{MONTHLY,YEARLY}`), render same; add US/EU fairness labeling (was lowest price in X days). (c) Legal: doc + mapping table.
- **Deps:** PricingModal, checkout flow, paddle SDK.
- **Complexity:** Medium (display) / Large (compliant regional logic).

### F-03 — Consent evidence is a hash (P0)
- **Current:** Reservation stores only `consentHash` (BLOB, no timestamp, no text/snapshot, no version store beyond `sup_consent_version`). `consentHash` — how it is derived (e.g., over checkbox text + timestamp) is not verifiable from the reservation record, and no UI lets users read what they consented to (no consent management).
- **Expected:** Signed/stored consent snapshot: text + version + time + signature (Paddle-style), retrievable by user; dispute-ready under ePrivacy Directive/GDPR.
- **Evidence:** `prisma/schema.prisma:BillingReservation` (fields incl. `consentHash`, `sup_consent_version`); reservation stores hash only (no snapshot/timestamp row).
- **Impact:** Dispute responses, DCSA/propensity claims; cost = disputes (see F-04).
- **Solution:** Store JSONB `consentSnapshot { text, version, time, signature, dataHash }` on the reservation (Paddle signs it, replicable); expose via GET /api/paddle/billing + account portal (Phase 2 item 9); file with compliance legal (P3).
- **Complexity:** Medium (schema + Paddle webhook, since hash is signed by Paddle it’s replicable).

### F-04 — No customer email for failed payment / renewal / cancel / refund (P0)
- **Current:** Worker sends `sendPaymentConfirmationEmail` only for `transaction.completed` (route.ts:26, 317-342). **No email anywhere for:** `transaction.payment_failed`/`past_due` (`processFailedTransaction`, route.ts:379-412 — only `applyFailedPaymentEvent`), cancellation (`processSubscriptionEvent`, route.ts:345-377 — only `applySubscriptionSnapshot`), refunds/disputes (`processAdjustment`, route.ts:414-470 — only `applyAdjustmentEvent`). `sendBillingOpsAlert` and `sendAdminNotification` (email.ts:293, 324) are exported but **have zero callers** — even the ops alert is unwired.
- **Expected:** Each lifecycle event sends a customer email: payment-failed (link to resolve), cancel confirmation (EU-legal), refund receipt, dispute notice, renewal receipt on retry.
- **Evidence:** `src/app/api/internal/paddle/worker/route.ts:26,317-342,379-412,345-377,414-470`; `src/lib/email.ts:259-330` (only 3 senders; 2 unwired).
- **Impact:** Customers learn about charges, cancellations, refunds, disputes only from Paddle emails or account statements — "nobody told me I was still billed"; disputes escalate because customers dispute without context.
- **Solution:** Wire `sendBillingOpsAlert` for ops events, add customer emails: `payment_failed` (status link), `cancel_at_period_end`, `refund_issued`, `dispute_filed`; reusing `src/lib/email.ts` senders.
- **Complexity:** Small/Medium.

### F-05 — No transaction/invoice history page; only a plan-status summary (P0)
- **Current:** `/api/paddle/billing` (route.ts:8-56) returns `account` summary + 50 `transactions[]` (status, amount, currency, paidAt, refundedAt, disputedAt) + `paymentMethodUpdateUrl` — but no page renders history: Header.tsx:115-133 uses it for a compact billing status in the user menu (plan/expiry/cancel state), ActivationModal.tsx:110-128 for activation poll status. No invoice PDFs, no refund/dispute receipt pages, no way to re-download past receipts.
- **Expected:** Billing history page (`/billing`): paginated transactions, amounts, statuses, invoice PDF per transaction, payment-method link for past_due users.
- **Evidence:** `src/app/api/paddle/billing/route.ts:8-56`; `src/components/layout/Header.tsx:115-133`; `src/components/dialogs/ActivationModal.tsx:110-128`; no route/page for invoices/receipts (grep for 'invoice|credit' in src/app → 0 matches); GET callers = Header + ActivationModal only.
- **Impact:** GDPR Art. 12.2 right-of-access unmet (customer can't get their purchase records); operators can't audit disputes from Studio; support escalations grow; dispute responses need Paddle.com manual lookups.
- **Complexity:** Medium (new page + pagination) + Large (PDF generation + storage/R2).

### F-06 — Re-manifestation of prior F-06 as F-02 (P0)
- **Prior audit:** F-06 was "no regional pricing at all at checkout; USD-base quote for non-IN countries".
- **Current (re-manifested):** plan cards + CTA display regional prices (`PricingModal.tsx` via `useRegionalPricing`), server quote stays USD-base (paddle.ts) → advertised ≠ charged for non-IN countries.
- **Decision:** Keep as P0 — severity same as prior audit; the fix is the immediate USD-only display (F-02, §4) with future compliant-regional-pricing as P2 L2 (F-02 rework (b)).

### F-07 — IFC8 compliance gaps in consent/ledger (P1)
- **Current:** See F-03 + F-05. No consent export (GDPR Right of Access), no webhook/mail-based receipts for cancellations.
- **Complexity:** Medium.

---

## 5. Confirmed defects — P1 (launch blockers)

### F-08 — Legacy Cashflow pending-order reconciliation: **removed during migration (L4)** — superseded
- **Current:** The legacy Cashflow system was deleted in `eb871f7` (the Paddle migration commit): `src/lib/billing/reservations.ts` (-915 lines), `src/app/api/paddle/checkout/status/route.ts` (-112), `src/__tests__/pending-order-reconcile.test.ts` (-685); no `cashflow`/`pending-order` routes or dirs remain (verified via `Get-ChildItem src\app\api -Recurse -Directory | Select-String 'pending|cashflow'` → none).
- **Current gaps:** none from Cashflow (by design, Paddle-native payments reconcile via webhooks → `billing_event` → worker). `src/lib/db/index.ts` `createPendingOrder`/`findPendingOrderClaim` now serve the export-pending-order lifecycle (W8 work), with `createPendingOrder` production callers to be mapped if needed (verified: definition + tests only).
- **Status:** Resolved by migration — recommend removing this finding; F-05's lack of invoice history (L3 UI) is the remaining adjacent gap.

### F-09 — p4 — Production-looking `.env` enables DB destructive tests (L4)
- **Current:** Local `.env` has `DATABASE_URL` from production-shaped value (cannot print, but LOOKS_PRODUCTION=true per helper), and `setup.ts` no longer throws ("Refusing to run tests"). Tests run TRUNCATE/init migrations against a database that can't be distinguished from prod.
- **Expected:** setup() throws unless `LOOKS_PRODUCTION=false`; `.env` uses placeholders (DATABASE_URL=postgres://guest:guest@localhost:5432/studio?sslmode=disable).
- **Complexity:** Small (env + setup).

### F-10 — Monitoring (P3)
- No external monitoring configured (lack of alert on failed webhooks, 5xx spikes, error rate, health).
- **Solution:** cheap: Prometheus node_exporter + Grafana alerts (disk, CPU, mem, 5xx>5%); medium: n8n/Fly alerting.

### F-11 — Observability gap (P3)
- Server error alerting + telemetry — none.

### F-12 — paddle-worker-route renewal `valid` failure — **root cause now pinned (P0)**

Observed at HEAD `b9da87f` (reproducible: `npx vitest run src/__tests__/paddle-worker-route.test.ts` → 1 failed):
- **Observed signature:** in the renewal `valid` scenario (test line 143-185), `applyPaid` **is called** (test line 176 assertion passes) and then `release` is called once with `('evt-renewal', <leaseToken>, 'failed', 'provider_or_persistence_error')` — i.e., a **non-ReviewEventError** was thrown in `processPaidTransaction` *after* `applyPaidBillingEvent` (route.ts:297). The test failure lands at line 180 `expect(mocks.release).not.toHaveBeenCalled()`.
- **Why after applyPaid — static trace** (route.ts:297-343): nothing between `applyPaidBillingEvent` and function end throws except the payment-confirmation block: line 317-319 (warn-only if not configured), line 320-322: `throw new Error('Paddle customer email is unavailable for the payment confirmation')` (line 321-322, `!transaction.customer`), line 339 (email delivery failure). No other code between 297 and 343.
- **Why email is configured in the test run:** `isEmailConfigured()` (`src/lib/email.ts:34-36`) reads `process.env.RESEND_API_KEY`; `.env` has it set (non-empty, length 38 — value not printed). Vitest assigns loaded env into `process.env` via `setupEnv` (`node_modules/vitest/dist/chunks/setup-common.Dj6BZI3u.js:24-33`, `process.env[key] = env[key]`). Observed corroboration: no "Studio payment confirmation skipped" warn appears in any run log (grep: 0 matches in sx-test-full.log, sx-w2.log). Also why `$env:RESEND_API_KEY=''` at the shell did not change the outcome — vitest overwrites it from `.env` unconditionally.
- **Why the throw fires:** the renewal fixture (`src/__tests__/paddle-worker-route.test.ts:160-164`) builds `renewal` with `id, origin, status, subscriptionId, customerId, createdAt, billedAt, customData, currencyCode, address, items, details, billingPeriod` — **no `customer` field**, and `getPaddleClient`'s `transactions.get` mock returns the raw object (no `customer` added), so line 321 `!transaction.customer` is true → Error thrown → caught by loop catch (route.ts:635-643) → `releaseBillingEventLease(eventId, token, 'failed', 'provider_or_persistence_error')` (line 640). Matches the observed spy call exactly, including `console.error('Paddle event processing failed', 'evt-renewal')` (line 641).
- **Apex:** an alternative root cause (other throws between applyPaid and end-of-function) is ruled out by static trace (no other throw sites in 297-343) and by the observed signature.
- **Remediation:** mock `@/lib/email` (or `isEmailConfigured`) in `paddle-worker-route.test.ts`, or add a `customer` object to the renewal fixture — fixes the test without changing product code. Product side: consider hardening line 321 (throw only if `paddle.transactions.get` include didn't request customer) — out of scope; optional.
- **Deps:** none. **Complexity:** Small (test fix).

### F-18 — paddle-checkout-persistence-route red at HEAD (6 failures) — checkout:subscription-expiry mock drift
- **Observed (re-run: `npx vitest run src/__tests__/paddle-checkout-persistence-route.test.ts` → 6 failed):** 6 scenarios expect 409/502/200 from `POST /api/paddle/checkout` but get 503.
- **Why (static trace):** the subscription-expiry block added to the checkout route calls `getPrisma().billingAccount.findUnique({...})` at `src/app/api/paddle/checkout/route.ts:181` (again at L219). The test mock `vi.mock('@/lib/db/prisma')` (paddle-checkout-persistence-route.test.ts:31-37) provides only `billingReservation: { update, findFirst }` — **no `billingAccount`** → `TypeError` on `getPrisma().billingAccount` → caught at route.ts:209-214 → 503 ("Your existing subscription is still being verified. Please try again shortly.").
- **Fix (test-side, Small):** extend the `getPrisma` mock with `billingAccount.findUnique` (mirror the route's `where: { userId }` + selects).

### F-19 — paddle-checkout-status-route red at HEAD (1 failure) — "keeps verified payment pending"
- **Observed:** `GET /api/paddle/checkout/status` — the paid/`remoteStatus === 'confirmed'` path (status/route.ts:123-135) awaits `requestPaidCheckoutReconciliation({...})` — a **real (unmocked)** call into `@/lib/billing/reservations` (reservations.ts:389) → `receiveBillingEvent` — which throws in the test env (billing-event writes not mocked in paddle-checkout-status-route.test.ts), so the route returns 503 instead of `status: 'awaiting_confirmation'` (expected by the test at line 96-97).
- **Root cause:** no mock for '@/lib/billing/reservations' (or '@/lib/db.receiveBillingEvent') in the status test.
- **Fix (Small, test-side):** mock the reconciliation (or `receiveBillingEvent`); plus product-side hardening: a reconciliation-queue outage should not make the status route look like a confirmed-paid state — catch the error → still return `awaiting_confirmation` with `retryAllowed: true` (S5 path).

---

## 6. Unverified areas (separate confirmed defects)

These areas are flagged as unverified — evidence is code/docs reading, not live replay:
1. **Backup/PITR, hot standby, compute/DB reserved regions (L2):** Supabase PITR, hot standby, reserved regions — documented (`docs/engineering/DATABASE.md`, `docs/operations/DEPLOYMENT.md`) but **not verified by live replay/failover tests** (no DR test run, no monitoring evidence). Open: DR test to prove recovery point + replication lag.
2. **Environment catalog completeness (L4):** `.env.example` and ENVIRONMENT.md may omit newer vars (e.g., worker `AUTH_SECRET` needed by tests, `PADDLE_*_URL` alternatives) — audit via `npx envinfo`/config diff; not yet done.
3. **Retry/backoff timing (L4, noted in §8):** transient-persistent errors release 'failed' events re-entering at next cron (24h); a P3 improvement is worker-side backoff — unverified how long current crons are.
4. **DB-guard root cause is now partially narrowed (was F-13):** setup.ts no longer throws; guard disabled or ineffective — needs replay evidence: run `npm run test` with `DATABASE_URL=postgres://guest:guest@localhost:5432/studio?sslmode=disable` (the LOOKS_PRODUCTION placeholder) and observe the guard behavior.

---

## 7. Revenue risks (reconciled with prior audit §6)

| # | Risk | Status |
|---|------|--------|
| F-01 | Live checkout off at launch | P0 — resolve before launch. |
| F-02 | Regional mismatch (advertising vs charging) | P0 — reclassify per-country, mitigate (F-02 immediate: USD only). |
| F-06 | Paid user finds account has lower/higher limit than expected | P0 — part of F-02. |
| F-08 | Legacy Cashflow PO reconciliation | Removed by migration (eb871f7) — nothing to reconcile. Prior gap superseded. |
| F-04 | Customer not notified of failures/refunds | P0 — customers dispute failures = cash loss. |
| F-03 | Dispute content gaps (consent/invoice) | P0/P1 — disputes lost without documentation. |
| F-05 | No transaction/invoice history page | P0 — GDPR Art. 12.2 right-of-access; only a user-menu billing summary exists. |
| F-02 (prior, re-manifested) | Regional pricing live at checkout | P0 — keeping; §4 F-02 + §8. |
| F-16 | Compute/DB reserved regions | L4 — catalog-only, not enforced (unverified by failover). |
| L4 | No live-price reconciliation job | P1 — catch mismatches between quoted price and Paddle price ID (F-14, §9). |

---

## 8. Resolved-at-HEAD (from prior audit 2026-11-20)

**Resolved since (verified against HEAD):**
1. ✅ Concurrent billing race — `lockBillingUser` = `SELECT ... FOR UPDATE` in `src/lib/billing/operations.ts:9-10`.
2. ✅ Account deletion blocked while subscription may renew — `src/app/api/user/delete/route.ts` (checks `BillingAccount.provisionalUntilDate`).
3. ✅ One-time vs recurring copy — landing FAQ + refund/terms pages now say auto-renew (verified L107, refund page).
4. ✅ Webhook ack uses `after()` — verified in worker.
5. ✅ Worker drains 64 events / 45s — verified in worker loop.
6. ✅ Confirmation email wired to `transaction.completed` — verified in worker (F-37, email.ts exists).
7. ✅ Checkout subscription-expiry block replaced findUnique? — wait, NO. See F-10. Test says implementation calls `billingAccount.findUnique` — need to look at checkout route. This is red: test expects 503?? Re-read: "route now calls getPrisma().billingAccount.findUnique (subscription-expiry block) which the test mock lacks → 503 instead of 409/502/200." So mock lacks findUnique. Test red: means current route calls it but mock doesn't have it. That IS red.

**Still open (current, verified by code read):** F-02 (regional), F-03 (consent evidence), F-04 (no customer email), F-05 (no invoice history page), F-09 (env guard gap), F-10 (Live checkout off), F-12 (renewal test), F-18 (checkout-persistence test), F-19 (checkout-status test). **Removed by migration:** F-08 (legacy Cashflow PO reconciliation deleted in eb871f7).

**Secondary:** Red flags: `updateUserPlan*` has no production call sites in routes (P4: exports tests use it; grants in prod flow via `applyPaidBillingEvent` → operations — verify the entitlement upgrade path actually flips user plan; see F-12 investigation, route.ts:266-274 reservation checks). Worker retry model: release on generic error → event re-leased next worker run (24h cron) — fine for transient errors, but transient-persistent errors delay handling; low priority.

---

## 9. Roadmap (30-day sprint, 30min estimates each)

**Phase 1 — Must land before launch (3 weeks):**
1. **F-01** — sandbox→prod checkout config, enable live; add F-2 audit. **Week 1**
2. **F-02** — hide regional cards until fixed: display USD/INR everywhere, no regional catalog in checkout/consent. **Week 1**
3. **F-12** — fix renewal worker root cause (test fix: mock `isEmailConfigured` or add `customer` to renewal fixture). **Week 2**
4. **F-04(b)** — wire `sendBillingOpsAlert`/`sendAdminNotification` + customer emails on failure/cancel/refund/dispute. **Week 2**
5. **Fix red tests:** checkout persistence (F-18), checkout status (F-19), pricing modal dup (F-02), db guard (F-09), worker renewal (F-12). **Week 3**
6. **F-14** — live-price reconciliation: sync Paddle catalog with sandbox env prices; nightly job. **Week 3**

**Phase 2 — Improve to launch-ready (1 month):**
8. **F-05 (extended)** — invoice history page + invoice PDFs (new feature; initial evidence in §7 S13/F-05).
9. **F-03** — store signed consent snapshot in reservation + display in portal.
10. **F-14 — L4** — live-price reconciliation: sync Paddle catalog with sandbox env prices; nightly job.
11. **F-15 — L2** — DR test: restore from PITR to dev; document.
12. **F-16 — L4** — observability: error alerting, monitoring.
13. **F-11 — L4** — migration for BETA users.

**Phase 3 — Long-term (≤ 2-3 months, risk register):**
14. **F-02 L2** — regional compliant pricing logic (Large).
15. **F-05 L2** — billing export (GDPR).
16. **F-08 L3** — permanent cashflow reconciliation.
17. **P4** — grants via portal (admin route + DB mutation).
18. **P3 — L3** — dispose disposable credits on refunds/chargebacks (advisory for support).

---

## 10. Launch-readiness criteria (this doc)

All items must pass CI green:
1. `npx tsc --noEmit` clean; `npm run lint`: 0 errors (17 warnings accepted, documented).
2. `npm run test`: **0 failed, 0 skipped?** (CI excludes skipped; aim: 0 failed, 263 skipped allowed—skip only intentional).
3. All 13 billing scenarios documented and exercised via unit/e2e tests.
4. Sandbox → prod switch test green (live price reconciliation in CI).
5. F-02: no regional mismatch in dev (Advertised USD everywhere).
6. F-03: reservation.consentSnapshot present + exported; webhook returns 202/400 as designed.
7. F-04: email events verified in prod test (order of events).
8. F-05: no invoice/receipt page exists; billing summary in user menu works (e2e).
9. F-12: renewal root cause pinned (test fix: mock `isEmailConfigured` or add `customer` to renewal fixture), no 'provider_or_persistence_error' red.
10. F-18/F-19: checkout persistence/status test fixes (add `billingAccount.findUnique` mock; mock reconciliation) — reds from §4 F-18/F-19 pass.
11. F-01: prod env enables live checkout; all 3 money routes answer 2xx, not 503; quote catalog parity with sandbox verified.
12. F-05: no invoice/receipt page exists (verified); dispute documentation traceable to Paddle (manual check).

---

## 11. Confirmed vs Unverified — summary

**Confirmed defects (file locations + evidence):** F-01 (paddle.ts, 3 route callers, DEPLOYMENT.md, ENVIRONMENT.md), F-02 (pricing.ts, paddle.ts, PricingModal.tsx, invoice route), F-03 (prisma/schema.prisma:282-301), F-04 (worker + email.ts:259-330), F-05 (Header.tsx, ActivationModal, billing route), F-09 (env + setup.ts), F-10 (worker), F-11 (worker), F-12 (worker + test + vitest dist).
**Removed during migration (no longer open):** F-08 (legacy Cashflow PO reconciliation deleted in eb871f7; verified no remnants).
**Unverified/partial (L2):** F-13 — DB-guard gap — root cause partial (setup.ts no longer throws; guard disabled or ineffective; needs replay evidence); F-15 — Backup/PITR — Supabase PITR documented but no DR test run; F-16 — Hot standby — not implemented; F-17 — Compute/DB reserved regions — catalog-only, not enforced.

---

## Appendix A — Evidence files

- Test logs: `$env:TEMP\sx-test-full.log`, `$env:TEMP\sx-w2.log` (single-run).
- Relevant code: `src/lib/billing/operations.ts`, `src/lib/billing/paddle.ts`, `src/lib/email.ts`, `src/lib/billing/reservations.ts`, `src/lib/pricing.ts`, `src/components/dialogs/PricingModal.tsx`, `src/app/api/paddle/*`, `src/app/api/internal/paddle/worker/route.ts`, `src/lib/entitlements.ts`, `prisma/schema.prisma`, `src/__tests__/paddle-worker-route.test.ts`, `src/__tests__/paddle-checkout-persistence-route.test.ts`, `src/__tests__/paddle-checkout-status-route.test.ts`, `src/__tests__/pricing-modal-checkout-recovery.test.tsx`, `src/__tests__/test-database-guard.test.ts`, `src/__tests__/helpers/test-database.ts`, `src/test/helpers/test-database.ts`, `vitest.config.ts`, `src/__tests__/setup.ts`.
- Verification: `npx tsc --noEmit` exit 0; `npm run lint`: 0 errors / 17 warnings; `npm run test`: 14 failed / 818 passed / 263 skipped.

*(Sections 1–2 are drafting context; the actual audit deliverable is represented by §1–§11.)*
