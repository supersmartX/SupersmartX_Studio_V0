# Change Control — SupersmartX Studio

> Phase 4 deliverable. The engineering rule that governs every future change in
> this repository, plus the open-decision register created during Phase 4
> contract reconciliation.

## The rule

    Contract
        ↓
    Authorization
        ↓
    Implementation
        ↓
    Verification
        ↓
    Certification
        ↓
    Commit
        ↓
    Push

### What each step means

1. **Contract** — The change is written down first, in the authoritative
   contract layer: `docs/FC-1.1.md` for product/behaviour decisions (via its
   §14 Change Request flow), `docs/API-CONTRACTS.md` for route contracts,
   `docs/DATA-OWNERSHIP.md` for state ownership, `docs/ENTITLEMENTS.md` for plan
   capabilities, `docs/EXPORT_PIPELINE.md` for the export artifact contract.
   A change with no contract representation does not start.

2. **Authorization** — The change is explicitly approved by the owner. Frozen
   documents (FC-1.1, and any doc marked FROZEN) may only change through their
   own Change Request flow with explicit approval. **No AI agent may silently
   change a frozen product decision** (FC-1.1 §14). Product decisions are never
   invented by an implementer — documentation or code is not "repaired" to
   match an assumption (FC-1.1 §14 last bullet).

3. **Implementation** — Code/UI/config changes follow the contract and
   authorization exactly. Discrepancies discovered mid-implementation are
   *reported and classified* in the change record, not papered over
   by editing either side.

4. **Verification** — The change is checked mechanically: `git diff --check`,
   `npx tsc --noEmit`, `npm run lint`, `npm test`, plus route-appropriate
   `npm run test:e2e` / `npm run test:mp4`. Results are recorded, with counts,
   in the change record. See `package.json` scripts for the verification commands.

5. **Certification** — **Certification requires evidence.** A phase or change is
   not "done" because the code works or the tests *should* pass. It is
   certified when every verification command's actual output is captured for
   the change. Unverified claims are not
   evidence; a green run on a *different* HEAD is not evidence for this change.

6. **Commit** — Only after certification. The commit message references the
   contract clause(s) and the verification evidence. Working-tree hygiene:
   `git diff --check` clean, no generated or secret files included.

7. **Push** — The last step, never before certification. Pushes are explicit
   owner actions; agents do not push unless the task authorizes it.

## Rules

- **Contract and code never silently diverge.** If they disagree: classify and
  report (documentation mismatch / code bug / product decision) and route a decision through this flow. Do not
  edit code to fit stale docs, and do not edit frozen docs to fit code.
- **Documentation-only corrections** of unambiguous factual staleness (counts,
  paths, version numbers, retired behaviours) are allowed without a CR — but
  must be called out in the change record. Decision-level content (product
  behaviour, entitlements, journeys) is never changed this way.
- **Certification evidence lives where the claim is made**: recorded counts in
  the change record, operational claims in `PRODUCTION-RUNBOOK.md`.
- **Secrets**: names only, in every document. Never a value.
- **Scope discipline**: a task that says "docs only" touches docs only; starting
  the next phase without instruction is a scope violation regardless of readiness.

### CR-003 (PROPOSED — NOT APPLIED, pending explicit owner approval): post-Phase-5 FC-1.1 baseline refresh

- **Reason**: FC-1.1 §1/§10/§12 status metadata now lags the completed
  Phase 5 (certified 2026-10-09) exactly as §1 "Tree" lagged Phases 2–4
  before CR-001. The contract file is frozen; only CR-001/CR-002 edits are
  approved so far.
- **Affected clauses (exact spots, verified 2026-10-09)**:
  1. §1 L23 "Tree" row — "HEAD `0a25fe7`" → current HEAD (working tree
     still uncommitted; value is the freeze-time external commit).
  2. §1 L24 "Phases" row — "Phases 0–4 COMPLETE; Phase 5 NOT STARTED"
     → "Phases 0–5 COMPLETE".
  3. §10 L418 Phase 5 row — `**NOT STARTED**` → `**COMPLETE**`.
  4. §12 L464–470 item 7 baseline — refresh counts to the Phase 5
     certified values: tsc PASS; lint 0 errors / 21 warnings; Vitest
     1125/1125 across 71 files; e2e full-suite 392 passed / 43 skipped /
     0 failed (435 total, 3 projects); `test:mp4` 30/30.
- **Impact assessment**: metadata-only; no product behaviour, invariant,
  or exclusion changes (same class as CR-001).
- **Status**: PROPOSED only. Not applied — FC-1.1 stays byte-identical
  until the owner explicitly approves this CR.
## How a future change flows (example)

To change an export limit:
1. Contract: CR against `ENTITLEMENTS.md` + `API-CONTRACTS.md` (and FC-1.1 §14
   if it touches a frozen clause).
2. Authorization: owner approves the CR in-repo.
3. Implementation: `entitlements.ts` + the enforcing route(s).
4. Verification: `entitlements.test.ts` + route tests updated to the new limit;
   tsc/lint/vitest green with recorded counts.
5. Certification: verification evidence refreshed; report.
6. Commit, then 7. Push.
