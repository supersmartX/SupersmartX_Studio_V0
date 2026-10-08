# Testing & Verification — SupersmartX Studio

> Phase 4 deliverable. Each verification layer states **what it proves** and — just
> as important — **what it does NOT prove**. Coverage claims are bounded to what
> was actually certified; nothing here is inflated. Commands and counts are taken
> from `package.json`, `playwright.config.ts`, `.github/workflows/ci.yml`, and the
> Phase 0–3 certification runs.

## The layers, in order of least → most end-to-end

### 1. TypeScript — `npx tsc --noEmit`

- **Proves**: the whole `src/` tree type-checks against `tsconfig.json`; route
  handlers, DB row types (`src/types/db.ts`), entitlements matrix, and component
  props are structurally consistent; no stale imports after refactors.
- **Does NOT prove**: runtime behaviour, that a `Promise` is awaited, that SQL is
  valid, or that any logic is correct. A green `tsc` says nothing about security.
- **Certified baseline**: PASS (Phases 0–3, re-verified in Phase 4).
- **Trap**: `.next/dev/types/validator.ts` corruption makes `tsc` fail on generated
  files — fix with `npx next typegen`, not by editing the generated file.

### 2. ESLint — `npm run lint` (`eslint .`)

- **Proves**: static correctness rules hold (unused vars, `react-hooks`
  violations, import hygiene, configured security-adjacent lint rules); CI treats
  errors as blocking.
- **Does NOT prove**: absence of warnings-level issues, absence of any class of
  vulnerability, or that warning counts trending up is safe. Lint is not a
  substitute for the contract review in `API-CONTRACTS.md`.
- **Certified baseline**: **0 errors, 21 warnings** (pre-existing, non-blocking;
  recorded so a future increase is visible).

### 3. Vitest unit/integration suite — `npm test` (`vitest run`)

- **Proves**: **1067 tests across 69 files** pass. This covers the pure-logic
  core (entitlements matrix, pricing/geo, clamping, state machines), DB
  atomic helpers, route handlers (via mocked `next/server` + DB), exporter
  pipeline units, and the certification-style suites (`state-machine-certification`,
  `state7-platform-matrix`, `state8-composition-accuracy`,
  `state8-detector-blind-spot`, `state20-browser-support`, `mic-mute-sync`).
- **Does NOT prove**: behaviour in a real browser (jsdom ≠ Chromium), real
  `MediaRecorder`/codec behaviour, real R2/Turso/Cashfree integration, real
  network failure modes, or that mocks match production wiring. Mocked route
  tests prove handler logic, not middleware/edge behaviour.
- **Certified baseline**: 1067/1067 PASS (69 files). Re-run in Phase 4.

### 4. Focused artifact-verification tests — `npx vitest run src/__tests__/artifact-verification.test.ts`

- **Proves**: the Phase 3 verifier's decision table — structural (`ftyp`/`moov`/
  `mdat`/video track), dimension match, duration tolerance, audio-expectation
  mismatch, oversize, malformed/truncated MP4, and bounded-read behaviour of
  `collectMp4Metadata` against synthetic and real-fixtured artifacts.
- **Does NOT prove**: every real-world encoder output passes or fails correctly;
  fixtures are constructed, not exhaustively sampled from production. It also
  does not prove the *route* wires the verifier in the right order — that is
  covered by route tests + `test:mp4`.
- **Certified baseline**: PASS (Phase 3; re-verified in Phase 4).

### 5. Playwright browser E2E — `npm run test:e2e` (`playwright test`)

- **Proves**: real Chromium/Firefox/WebKit flows across **15 spec files**
  (`smoke`, `auth`, `api`, `pricing`, `studio`, `landing`, `support`,
  `export`, `export-lifecycle`, `recording-loop`, `edge-cases`,
  `workflow-ownership`, `state1-anonymous-free`, `state2-free-platform-locks`,
  `p0-upgrade-preserves-recording`): anonymous→free plan locks, auth flows,
  export lifecycle, and ownership denials in a real browser against `npm run dev`
  (`playwright.config.ts` `webServer`).
- **Does NOT prove**: production build behaviour (dev server ≠ `next build`
  output), real payment/R2/DB services (tests stub or mock them), cross-device
  hardware camera/mic behaviour, performance under load, or cross-browser beyond
  the configured projects.
- **Certified baseline**: **chromium 138 passed / 3 skipped / 0 failed** (Phase 3).
  Skips are explicit `test.skip`s, not silent passes.

### 6. Real MP4 end-to-end — `npm run test:mp4` (`node scripts/state8-e2e/run.mjs`)

- **Proves**: a genuine encoded MP4 goes through the **actual** server-side
  verification path (`readMp4Artifact → collectMp4Metadata → verifyExportArtifact`)
  and the completion contract's byte/ownership semantics — 30/30 checks,
  including the detector blind spots called out in `state8-detector-blind-spot`.
- **Does NOT prove**: browser-side encoding (it runs in Node), R2 copy behaviour
  against live R2, or quota interactions under concurrency.
- **Certified baseline**: **30/30 PASS** (Phase 3; re-verified in Phase 4).

### 7. State-7 platform matrix & state-8 composition accuracy (within Vitest)

- **Prove**: every launch-platform preset clamps to its exact authoritative
  dimensions server-side (720p envelope for Free, 1080p for Creator, orientation-
  independent), and that composition-accuracy claims (dimensions/audio/duration
  expectations) match what the verifier enforces.
- **Do NOT prove**: any platform's *recommendation policy* (that is a product
  decision, not a tested contract), or that future presets are auto-covered —
  new presets must be added to the test matrix deliberately.

### 8. Manual production certification — `audit/RELEASE_CERTIFICATION_CHECKLIST.md`,
   `audit/RELEASE_CERTIFICATION_RUNBOOK.md`

- **Proves**: a human exercised the release path in the real environment
  (login, payment in sandbox, real export, download, delete) with recorded
  results — the only layer that touches live Cashfree/R2/Turso.
- **Does NOT prove**: repeatability or regression safety; it is a point-in-time
  attestation and must be re-run per release.

## What NO layer currently proves

- **Distributed rate limiting**: the limiter is in-process; no test proves
  behaviour across concurrent serverless instances.
- **Voice teleprompter**: it does not exist in `src/` (marketing copy only —
  see `TRACEABILITY.md` findings); there is nothing to test.
- **Free-plan cloud upload quota**: Free is rejected 403 *before* quota logic on
  both upload routes, so the `maxUploads`/`maxStorageMB` path for Free is
  unreachable and untested end-to-end (finding F-01).
- **Load, soak, and chaos**: no perf suite exists.

## CI vs local

| Command | CI (`.github/workflows/ci.yml`) | Local |
| ------- | ------------------------------- | ----- |
| `npm run lint` | blocking (errors) | warnings visible |
| `npx tsc --noEmit` | blocking | blocking |
| `npm test` | blocking | blocking |
| `npm run test:e2e` | separate Playwright job (`needs: lint, typecheck, test`): build + `test:e2e` | `npm run dev` must be up (auto via webServer) |
| `npm run test:mp4` | **not in CI** — run locally/as part of verification | `node scripts/state8-e2e/run.mjs` |
| `npm run build` | blocking (Vercel build is authoritative) | spot-check |

## Phase 4 re-verification (2026-10-07, HEAD `9e42c18`, docs-only diff)

| Command | Result |
| ------- | ------ |
| `git diff --check` | exit 0 (no whitespace errors) |
| `npx tsc --noEmit` | PASS (exit 0) |
| `npm run lint` | **0 errors / 21 warnings** — baseline match |
| `npm test` | **1067/1067 passed, 69 files** — baseline match |
| `npm run test:e2e` | **423 tests: 384 passed, 39 skipped, 0 failed** (chromium 138 ok / 3 skipped — exact Phase 3 baseline; firefox 108 ok; mobile-chrome 138 ok), exit 0 |
| `npm run test:mp4` | **30/30 PASS** — baseline match |

`git status --short` confirmed the diff touched **only `docs/*.md`** files, so
these runs re-prove the certified baselines rather than any code change.

## Rules for maintainers

1. A contract change (`docs/FC-1.1.md` flow) lands with a test that fails
   without it — traceability in `TRACEABILITY.md` names the exact test file.
2. Never weaken a certified baseline silently: if counts change (files, tests,
   warnings, skips), update the baseline note here in the same change.
3. Do not describe a layer as "proving" anything it cannot see (mocked ≠ real,
   dev server ≠ production build, point-in-time manual ≠ automated).
4. Verification evidence (command + result + date + HEAD) is what certification
   means — see `CHANGE-CONTROL.md`.
