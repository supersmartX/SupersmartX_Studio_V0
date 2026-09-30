# OWNER PRODUCTION CERTIFICATION RUNBOOK

Purpose: clear the 9 evidence blockers in `audit/RELEASE_CERTIFICATION.md`
with live evidence (Tests 1-9), plus the two harness/decision items
(blockers 10-12: see Test 10 and section 13). Already-PASS rows from
`audit/PRODUCTION_VALIDATION_RESULTS.md`
(2026-09-22: 401 gates, anti-enumeration, bogus-token 400, unsigned-webhook
400, health-DB, domain/headers) are NOT repeated here except Test 0 re-confirm.

Test 10 (PV-GOLDEN) is the highest-value test in this runbook and the only
one that observes the master-recording guarantee. Run it first; do not skip
it because Tests 1-9 already passed.

Note on numbering: this file has both tests and policy sections. "Test N"
(or the PV-* ID) always means a procedure; "§N" always means a policy
section. So "Test 10" is the golden path and "§10" is the evidence standard.

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
| Golden-path actor (`owner-cert-g+…`) | Test 10 only: records while anonymous, then authenticates and pays | anonymous → creator |
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
Note: 404 here is DELIBERATE and correct. Returning 403 for another user's
export would confirm the id exists, turning /api/exports into an enumeration
oracle. If a cross-account request returns 403, record it as a FAIL and
report it - do NOT "fix" the route to return 404-style behaviour without
treating the 403 as a finding. Any expectation of 401/403 in a test plan for
this row is wrong; the correct expectation is a non-2xx that is
indistinguishable from a nonexistent id.
Evidence: status codes per attempt + bucket-policy screenshot.
Cleanup: delete User A export via API (verifies delete path too).

### Test 5 — Signed URL (PV-URL)

1. User A requests download → 200 with `url` + `expiresIn`.
2. Download the URL → success.
3. Re-request after TTL elapses → old URL fails, new URL works.
4. Logged-out request for URL generation → 401.
5. User B requests URL for User A export → 404 (cross-user denial; see the
   404-not-403 note in Test 4 — a 403 here is a finding, not a pass).
6. Confirm the 404 for User B is byte-identical in shape to the 404 for a
   nonexistent id, so neither reveals existence.
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

### Test 10 - Golden path, one actor end to end (PV-GOLDEN)

Run this FIRST in the session. It is the only test that exercises the whole
chain in one browser profile, and it is the only place the master-recording
guarantee is actually observed. Tests 1-7 each prove one subsystem in
isolation and would all pass while this failed.

Preconditions (these are correctness requirements, not conveniences):
- Use ONE normal browser profile end to end. The master lives only in
  IndexedDB (`sxs-studio`, store `recordings`) on this device. Do not switch
  to a private window, do not clear site data, do not change device or
  browser mid-flow - any of these will destroy the master and the test will
  fail for the wrong reason.
- The master has a 24h retention window. Start the recording and finish the
  download inside that window. If the session is split across days, this
  test must be re-run from the start, not resumed.
- Keep DevTools open on the Application panel for step 3 onward.

1. Anonymous, no login: open `https://studio.supersmartx.com/studio`, grant
   camera + mic, record a real take (30s+ of visible motion and audio so a
   re-encode cannot coincidentally match).
2. Stop, land in review, confirm the master is present and playable.
3. Record the master's identity BEFORE any auth or payment. DevTools ->
   Application -> IndexedDB -> `sxs-studio` -> `recordings`: capture the
   row's `id`, `size` (bytes), `durationMs` and `createdAt`. Screenshot.
   These four values are the pass/fail oracle for step 8.
4. While still anonymous and Free: export. Expect the Free envelope -
   watermarked, YouTube-landscape 1280x720, local download only, no R2 row.
   Save the file and note its dimensions and duration.
5. Now start the Creator purchase from the review screen. Expect the auth
   modal first (guest checkout must not be possible).
6. Authenticate (email signup, or the Google identity from Test 2). Return to
   /studio. Assert the review screen still shows the master, and that
   IndexedDB still holds the same `id`/`createdAt`.
7. Complete payment in Cashfree sandbox. Assert: signed webhook received,
   `processed_webhooks` gains the order id, plan flips to creator with a
   future expiry. Replay the same signed webhook once and assert plan expiry
   is unchanged (dedupe holds inside the golden path, not only in Test 7).
8. RELOAD /studio (full page load, same profile) and open Library. This is
   the critical assertion of the whole program:
     - the restored take's `id`, `size` and `createdAt` in IndexedDB are
       IDENTICAL to step 3 (not merely "a recording exists"),
     - its `durationMs` is unchanged,
     - the review screen renders the same take, not an empty state.
   Any of these differing = FAIL, and the master was replaced or lost across
   the auth+payment boundary.
9. Export the same master as Creator. Expect the Creator envelope - no
   watermark, 1920x1080, R2 row created, object present under
   `exports/{user-id}/{uuid}.mp4`.
10. Cross-check the two exports: they must share the same source duration
    (within one frame), while differing in watermark and resolution. Equal
    duration with different envelopes proves the plan flip took effect AND
    that both exports came from the same master rather than a re-record.
11. Library -> download -> signed URL -> file lands on disk. Open it: it is a
    real, playable MP4 whose dimensions match the Creator export.
12. Negative tail: as User B, attempt step 11 against User A's export id -
    expect 404 (see the note in Test 4: 404 is correct, 403 is not).

Evidence: step 3 and step 8 IndexedDB screenshots side by side (this pair is
the deliverable - the invariant is only visible as a before/after
comparison), order id, dedupe proof, plan before/after, both export
envelopes, R2 key, signed-download status, downloaded file's dimensions.
Status is PASS only if every step matched, and specifically only if the
step 3 / step 8 identity comparison is exact.
Cleanup: delete the golden-path actor and all `owner-cert-` exports, jobs,
orders and R2 objects; final row-count sanity check.

NOTE - what this test does NOT prove: the master is device-local. It is not
a server-side backup and does not survive a cleared browser profile, a
different device, or the 24h window. If any user-facing copy or marketing
implies "your recording can never be lost", that is a claim this test does
not support.

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

When every Test 1-10 row is PASS with evidence: update
`audit/RELEASE_CERTIFICATION.md` to CERTIFIED (move remaining items, if any,
to NOT VERIFIED with reason — CERTIFIED requires zero critical gaps).
Any FAIL follows the program Final Rule: record → root-cause → smallest fix
→ regression test → full gates → re-run affected test → update certification.

## 13. Browser support decision (owner sign-off, not a test)

Blocker 11 is a decision, so it cannot be cleared by running anything. It
needs a recorded decision, then the wording follows from it.

Verified position as of 2026-10-01 (local evidence only):
- Chromium: PASS, 125 passed / 3 skipped.
- Mobile Chrome (Pixel 5): the mobile auth path is proven working by hand
  (burger → menu → Log in → dialog), but 9 specs are viewport-unaware and
  fail. Blocker 12. This is a test defect, not a product defect — do NOT
  change the mobile UX to satisfy those specs.
- Firefox: 57 of 59 failures are `Unknown permission: camera`, i.e. the
  harness cannot grant camera access. The real Firefox signal is therefore
  unmeasured, and two genuine candidates remain untriaged (Escape not
  dismissing a modal; a hero overlay intercepting footer legal links). Both
  pass on Chromium.
- Safari/WebKit: binary present, no project configured, zero evidence.

The product's current guidance is the export capability gate telling users to
"use Chrome or Edge". Record one of the following, with the date and the
reason:

A. Supported: Chrome + Edge only, explicitly. Then the gate's wording is
   correct as-is, and Firefox/Safari users get a clear, intentional message.
   Record Safari and Firefox as out of scope with this evidence gap stated.
B. Firefox supported: fix the harness first (grant camera another way), then
   triage the two untriaged candidates, then re-record. Do not record PASS
   on the strength of Chromium results.
C. Safari supported: this is a real engineering item, not a documentation
   one. WebCodecs/`VideoEncoder` behaviour on Safari and iOS must be
   established before any claim is made. Budget it as work.

Until a decision is recorded, blockers 10-12 stay open and nothing
user-facing may imply broader browser support than Chromium has evidence for.
