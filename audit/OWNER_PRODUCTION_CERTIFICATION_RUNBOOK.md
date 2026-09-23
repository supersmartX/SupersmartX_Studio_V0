# OWNER PRODUCTION CERTIFICATION RUNBOOK

Purpose: clear the 9 blockers in `audit/RELEASE_CERTIFICATION.md` with live
evidence. Already-PASS rows from `audit/PRODUCTION_VALIDATION_RESULTS.md`
(2026-09-22: 401 gates, anti-enumeration, bogus-token 400, unsigned-webhook
400, health-DB, domain/headers) are NOT repeated here except Test 0 re-confirm.

Rules: dedicated test accounts only — never real customer data. Record every
test with the Evidence Standard (§10). Redact everything per §11. PASS
requires cited evidence; otherwise NOT VERIFIED.

## Before session

### Required access (responsible provider in brackets)

- [ ] Vercel project (deployments, env vars, cron runs, server logs) [Vercel]
- [ ] Production app `https://studio.supersmartx.com` (browser) [Vercel]
- [ ] Turso dashboard / DB shell for prod (read + disposable-write) [Turso]
- [ ] Cloudflare R2 bucket inspection (keys, no public access) [Cloudflare]
- [ ] Cashfree dashboard, sandbox/test mode available [Cashfree]
- [ ] Google OAuth client config [Google Cloud]
- [ ] Resend dashboard + a controlled mailbox [Resend]
- [ ] Monitoring/log viewer (Vercel logs + any Discord webhook target)

### Required test accounts / data (create at session start, delete at end)

| ID | Purpose | Plan |
| -- | ------- | ---- |
| User A (`owner-cert-a+…`) | primary actor | free, then upgraded via Test 7 |
| User B (`owner-cert-b+…`) | cross-user attacker | free |
| OAuth identity | new + existing-account linking | n/a |
| Disposable exports/jobs/orders | prefixed `owner-cert-`, deleted after | n/a |

Pre-session check: `GET /api/health` → 200 `healthy`; note the `commit`
field (short SHA; `unknown` only if the deploy predates the traceability
change — redeploy first so the live SHA matches the certified tree).

---

### Test 0 — Re-confirm prior PASS rows (5 min, optional but recommended)

Re-run: anon `/api/exports` → 401; `/api/health` → healthy + `commit`
matches the Vercel deployment SHA. Evidence: status codes + body (redacted).

### Test 1 — Authentication (PV-AUTH)

1. Sign up User A (disposable email) → expect success, session created.
2. Log out → log in (correct + wrong password ×1) → success / generic failure.
3. Inspect `Set-Cookie`: expect `__Secure-` prefix, `Secure`, `HttpOnly`.
4. Reload /studio → session persists. Log out → protected API → 401
   (session invalidated).
5. Password reset for User A: email arrives (check sender domain), token
   works once, old sessions killed (re-login required on second browser).
6. Expired session: confirm refresh/re-login behavior, no crash.
Evidence: screenshots + status codes + cookie flags (values redacted).
Cleanup: none until Test 9 done (account needed throughout).

### Test 2 — OAuth (PV-OAUTH)

1. New Google identity → sign in → callback → session; user row exists.
2. Same identity again → existing account, no duplicate.
3. User A links same Google email → single account (verify id alignment).
4. Cancel at provider + simulate denied callback → app handles gracefully,
   no session, no 500, no leak.
5. Session persists after OAuth across reload.
Evidence: callback URLs + session state + user-row check (ids only).
Cleanup: delete OAuth test rows with Test 3 procedure.

### Test 3 — Database lifecycle (PV-DB)

On prod DB (disposable rows only):
1. Confirm `SELECT value FROM schema_meta WHERE key='schema_version'` → `10`.
2. Create user C directly (or via Test 1) + export + job rows; verify
   `exports.user_id`, `export_jobs.user_id` relations.
3. `PRAGMA foreign_keys` → `1` on the app path (code-enforced; spot-check).
4. Delete user C → verify `exports`, `export_jobs`, `user_stats`,
   `monthly_export_counts`, `pending_orders` rows gone (CASCADE).
5. Create job with linked export, delete the job → export survives with
   `job_id IS NULL` (SET NULL).
6. Run cleanup endpoint with valid `CLEANUP_SECRET` on an aged test job →
   job + R2 object removed, linked export preserved.
Evidence: row counts before/after (ids only), timestamps.
Cleanup: delete all `owner-cert-` rows; verify counts return to baseline.

### Test 4 — R2 isolation (PV-R2)

1. User A creates an export (small MP4) → confirm key
   `exports/{A-id}/{uuid}.mp4`, bucket still denies anonymous GET on it.
2. As User B: `GET /api/exports/{A-export-id}` → 404; `/api/download?
   exportId={A-id}` → 404; `/api/exports/{A-id}/preview` → 404.
3. As User B: tampered `exportId=../…` variants → 400/404, never 200.
4. Direct R2 URL guessing (no signature) → denied.
Expected: ALL UNAUTHORIZED ACCESS REJECTED, no id oracle (404 not 403).
Evidence: status codes per attempt + bucket-policy screenshot.
Cleanup: delete User A export via API (verifies delete path too).

### Test 5 — Signed URL (PV-URL)

1. User A requests download → 200 with `url` + `expiresIn`.
2. Download the URL → success.
3. Re-request after TTL elapses → old URL fails, new URL works.
4. Logged-out request for URL generation → 401.
5. User B requests URL for User A export → 404 (cross-user denial).
Evidence: `expiresIn` value, pre/post-expiry fetch statuses (redact URL
strings — store only domain + status + timestamps).
Cleanup: covered by Test 4 cleanup.

### Test 6 — Entitlements (PV-ENT)

For free (User B) and creator (User A post-Test 7):
1. Resolution: free 1080p/custom request → clamped or 403; creator 1080p → ok.
2. Duration over 600 s as free → 403 with plan message.
3. Platform: free instagram-reels/tiktok/custom → 403; youtube-landscape → ok.
4. Crop params as free → 403; as creator → ok.
5. Storage/upload caps as free (3 files / 500 MB) → 4th upload or oversize → 403.
6. Repeat 1–4 with hand-crafted API calls (curl), bypassing the UI.
Expected: server authoritative in every case; client values never decide.
Evidence: request/response pairs (bodies; no tokens).
Cleanup: delete test exports; confirm quota counters sane afterwards.

### Test 7 — Cashfree (PV-PAY)

Use provider-supported sandbox/test mode; NO unnecessary real-money charge.
1. User A creates order → order id + payment session returned; `pending_orders`
   row exists with server-derived amount/currency.
2. Complete test payment → webhook fires → signature verifies → plan flips to
   creator with future expiry; confirmation email arrives.
3. Replay the same webhook → deduped (`processed_webhooks`), single activation.
4. Send tampered/unsigned webhook → 400, no plan change.
5. Failed payment → no activation; pending order stays pending.
Evidence: order id, webhook statuses, plan before/after, dedupe proof
(secrets and full payloads redacted; amounts only).
Cleanup: downgrade/delete test user; retain order ids list for records.

### Test 8 — Cron (PV-CRON)

1. Vercel cron dashboard: confirm `POST /api/export-jobs/cleanup` schedule
   `0 2 * * *` and last-run timestamp/status.
2. Wrong/missing `x-cleanup-secret` → 401 (do NOT brute-force; one negative
   test max).
3. Aged disposable job → next run (or manual owner-approved trigger) removes
   job + R2 object; linked export row preserved (`job_id` NULL).
4. Duplicate execution safety: re-run is a no-op success.
Evidence: cron timestamps, run statuses, row/object counts.
Cleanup: remove test jobs/objects.

### Test 9 — Email + observability (PV-OBS)

1. Password-reset email (Test 1) + payment email (Test 7): delivered, correct
   sender domain, links point at canonical domain.
2. Trigger one controlled client error → appears in ingestion/monitoring.
3. Review server logs for the session window: confirm request-ids correlate,
   user ids hashed, and NO passwords/tokens/keys/secrets/signed URLs/PII.
4. Vercel env audit: every name in `docs/ENVIRONMENT.md` → Configured YES/NO,
   Used-correctly YES/NO (values NEVER recorded).
Evidence: delivery headers (redacted), log excerpts (redacted), env table.
Cleanup: delete Users A/B + OAuth rows + all `owner-cert-` artifacts; final
row-count sanity check.

---

## 10. Evidence Standard

```text
Test ID:        PV-XXX-NN
Date:           YYYY-MM-DD HH:MM UTC
Environment:    https://studio.supersmartx.com (commit <short-SHA>)
Account/Data:   User A/B ids only (no passwords)
Procedure:      numbered steps as executed
Expected:       from this runbook
Actual:         observed statuses/values
Status:         PASS / FAIL / NOT VERIFIED
Evidence:       screenshots, status codes, redacted excerpts, timestamps
Cleanup:        what was deleted + verification
```

## 11. Secrets policy

NEVER in repo files, screenshots, or pasted logs: passwords, API keys,
tokens, Cashfree/OAuth secrets, DB/R2 credentials, full signed URLs, raw
request bodies containing PII. Redact before saving; store evidence in the
owner-controlled vault, reference by id/date in audit files.

## 12. Closing the certification

When every Test 1–9 row is PASS with evidence: update
`audit/RELEASE_CERTIFICATION.md` to CERTIFIED (move remaining items, if any,
to NOT VERIFIED with reason — CERTIFIED requires zero critical gaps).
Any FAIL follows the program Final Rule: record → root-cause → smallest fix
→ regression test → full gates → re-run affected test → update certification.
