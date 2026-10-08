# PHASE 4B — UI/UX Remediation Verification

**Date:** 2026-10-07
**Scope:** Implement only the 8 P1 findings of `docs/UI-UX-AUDIT.md` (Phase 4A), verify with all gates plus browser/responsive/accessibility checks, and record anything observed but out of scope.
**Constraints honored:** no commit, no push; no architecture, pricing/entitlement, authentication-architecture, recording, or export-architecture changes; no P2 fixes; no API/server changes; no invented problems — the audit is the single source of truth.

**Verdict:** **PHASE 4B — CERTIFIED GREEN** — see §9.

---

## 1. Summary of changes

21 files changed, +155/−48 — all surgical, no unrelated refactors.

| P1 | Finding | Change | Files |
|----|---------|--------|-------|
| **P1-1** (UX-001) | `--color-text-muted` fails AA on several surfaces | Token `#52525B` → `#8D8D96` | `src/app/globals.css` |
| **P1-2** (UX-002) | Pause unnamed; Stop name changes Visible→Confirm; status word hidden on mobile | Pause `aria-label="Pause Recording"`; paused Stop gets stable `aria-label="Stop Recording"` (kept across the Visible→Confirm swap, with comment); removed `hidden sm:block` from the Recording/Paused/Ready words. **No new sr-only live region** — `RecordingBadge` is already `role="status" aria-live="polite"`, so a second region would double-speak | `src/components/layout/TransportBar.tsx` |
| **P1-3** (UX-003) | Review shows an empty "Publish" inspector panel (false affordance) | `InspectorPanel` now returns `null` for `inspectorContext === 'review'` (drawer would otherwise render an empty titled region). `headerLabel`'s 'Publish' branch left as dead-but-harmless with comment | `src/components/layout/InspectorPanel.tsx` |
| **P1-4** (UX-004) | Discord promo sits in the Export CTA path | Discord block gated to `{step === 'done' && …}` — reachable only after export success; the failure path returns to the `platform` step (audit's chosen placement). Support access preserved; Discord exists nowhere else in-app | `src/components/dialogs/ExportModal.tsx` |
| **P1-5** (UX-005) | Header "Log in" opened the registration chooser | `AuthModal` gains `intent?: 'register' \| 'login'` (default `register`); `initialStep` seeded from intent and re-seated on every `isOpen`; aria-label derived from the visible `h2`. Verified structure: **chooser step = registration** ("Create New Profile" + Google + Create Account), **email step = sign-in** ("Enter your email", submit "Log in", "Back to all options"). Studio: local `authIntent` state — Header `onSignIn` → `login`, every other opener → `register`. Landing: desktop/mobile "Log in" → `login`, creator CTAs → `register` | `src/components/auth/AuthModal.tsx`, `src/app/studio/page.tsx`, `src/app/page.tsx` |
| **P1-6** (UX-006, pill half) | Status pill clipped behind Focus View at 430/390/375 | `RecordingBadge` `top-3 left-3` → `top-14 left-2 sm:top-16 sm:left-3` (below the 44 px Focus View button at every breakpoint). Not hidden — still in canvas, still announced. JS comment placed **above** the `return` (a JSX comment after `return (` is invalid) | `src/components/studio/RecordingBadge.tsx` |
| **P1-7** (UX-007 + §11) | Primary-path targets measured 16–38 px | Raised to ≥40 px (≥44 where the surface was already larger) **only** on audit-flagged targets — no indiscriminate enlargement: `Select` `min-h-[40px]`; AuthModal show-password ×2 → 44×44, auth links `after:-inset-x-3 after:-inset-y-3`; InspectorPanel section headers `after:-inset-y-3`, Clear → 40×46 box / ≥40 effective, align buttons `min-h-[40px]`; DeviceSelectorBar bar `h-11`, selects `h-10`, refresh `min-w/h-[40px]`; IconRail nav `min-h-[40px]`; Header logo `py-2.5`; PlatformPreviewSwitcher chips `after:-inset-y-[5px]` **plus `py-1.5` on the chip row** (the row is `overflow-x-auto`, which computes `overflow-y: auto` and was clipping the ±5px expansion — the padding keeps the pseudo inside the scroll container; measured 30 → 41 effective, no x-growth); landing CSS vars `--lsx-nav-h` / `--lsx-btn-h` / `--lsx-hero-btn-h` → 40 (`.lsx-btn` / `.lsx-nav-pill` use `overflow:hidden`, so var-height was required); `.lsx-logo::after` and `.lsx-footer-link::after` insets; `pricing.css` `.lsx-pricing-toggle-btn { min-height: 40px }` | `src/components/ui/Select.tsx`, `AuthModal.tsx`, `InspectorPanel.tsx`, `DeviceSelectorBar.tsx`, `IconRail.tsx`, `Header.tsx`, `PlatformPreviewSwitcher.tsx`, `src/app/page.tsx`, `src/styles/pricing.css` |
| **P1-8** (UX-008) | Bare "Continue" payment CTA | Guest upgrade CTA `'Continue'` → `'Create account to purchase'`; signed-in keeps `'Buy Creator access'`. PricingModal's "Continue to Payment"/"Continue with Free" untouched (not flagged). **No pricing/entitlement changes** | `src/components/dialogs/UpgradePromptModal.tsx` |

### E2E spec updates (required by P1-5 / P1-8)

Six specs asserted the **old buggy behavior** and had to change with the fix:

- `e2e/helpers.ts` `openAuthFromLanding` + `e2e/smoke.spec.ts` local `openAuth`: after clicking "Log in" they now click **"Back to all options"** — P1-5 makes "Log in" open the sign-in step, while these tests need the chooser surface.
- `e2e/smoke.spec.ts` checkout-intent dialog-name regex extended with `create new profile` (the chooser's accessible name follows its visible heading now).
- `e2e/state2-free-platform-locks.spec.ts` (×2): `'Continue'` → `'Create account to purchase'`.
- `e2e/p0-upgrade-preserves-recording.spec.ts`: CTA regex → `/^(Create account to purchase|Buy Creator access)$/`; dialog name `'Log in or create account'` → `'Create New Profile'`.
- `e2e/workflow-ownership.spec.ts`: same CTA regex.
- `e2e/state1-anonymous-free.spec.ts`: absence-check regex extended with `Create New Profile` (2 sites).

No e2e asserted the Publish panel, Discord placement, status-word hiding, or badge position.

---

## 2. Gates

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | **0 errors** (re-run after the final source + e2e edits) |
| `npx eslint .` | **0 errors**, 21 warnings — all pre-existing at HEAD; e2e files are ignored by the ESLint config (0 errors from the changed files) |
| `npx vitest run` (full suite) | **69 files, 1067/1067 passed, exit 0**. Required stopping the dev server first — `EBUSY … data\supersmartx.db` (dev server held the SQLite lock; environmental, unrelated to the changes), then restarted `next dev`. Note: one intermediate full run had a single transient failure in `security.test.ts` (`creator user remains allowed on legacy export-upload route`) — that file passes 58/58 standalone and the full suite passes on re-run; it is a parallelism-sensitive flake in an untouched server test, not a regression (the P1 edits are UI-only) |
| Chromium Playwright suite (`npx playwright test --project=chromium`) | First full run: **136 passed, 3 skipped, 2 failed**. The 3 skips are environmental (`TURSO_DATABASE_URL` / non-chromium / missing R2 credentials — `test.skip` at HEAD, pre-existing). The 2 failures were `smoke` tests encoding pre-P1-5 behavior (`invalid email…` opened via "Log in" and expected the register form; `checkout intent…` expected the old dialog name) — both fixed in §1; final re-run at the exact final state: **138 passed, 3 skipped, 0 failed (13.7m)** |

---

## 3. Browser verification method

Headless Chromium (Playwright) against `next dev` on `:3000`, fake camera/mic (`--use-fake-device-for-media-stream`), guest sessions. JSON probes preferred over image reads; screenshots kept as supporting evidence.

Primary probe: `ui-audit\p4b-verify.mjs` → `shots\p4b-verify.json` (final canonical run at the exact final state: **`failedSteps: []`, `targetFails: []`, `consoleErrors: 0`**; the immediately prior attempt had one transient step failure — `p1-2-names` waiting for Stop Recording — with an identical script that had passed the two runs before it and passed again on re-run, an environment flake with no source delta in that step's path). Supporting probes: `timer-glyph-probe.mjs`, `drawer-close-probe.mjs`, `camera-drawer-probe.mjs`, `p4b-gap-probe.mjs`.

Measurements:
- **Box targets:** `getBoundingClientRect()` of the border box.
- **Pseudo-grown targets** (footer links, section headers, Clear, logo, chips): effective hit rect via `document.elementsFromPoint` walk from the element's center, 1 px steps sampled half a pixel inside each candidate — the real "where can a pointer land on this element" measure.

Viewports swept: **1440, 1280, 1024, 912, 430, 390, 375** (landing at all seven; studio at 1440/1280 plus the mobile drawer at 430/390/375).

---

## 4. P1-by-P1 verification

### P1-1 — muted token contrast
In-page token + WCAG ratio computation over every surface the token sits on:

| Surface | Ratio (AA needs 4.5) |
|---------|----------------------|
| `--color-surface` | 5.73 |
| `--color-canvas` | 6.05 |
| `--color-surface-elevated` | 5.38 |
| `--color-overlay` | **4.53** |
| `--color-input` | 5.29 |
| recording hover surface | 5.26 |

`allPass: true`. Token now `#8D8D96`. The landing page uses its own rgba palette (untouched, unaffected by this token) — noted so the landing's separate muted grays aren't mistaken for misses.

### P1-2 — recording controls' accessible names + mobile status
Footer dumps (`footer[aria-label="Recording controls"]`):

| State | Buttons (aria-label / size) | Status word |
|-------|------------------------------|-------------|
| idle | Mute microphone 44×44, **Start Recording 56×56** | — |
| recording | Mute 44×44, **Stop Recording 56×56**, Pause Recording 44×44 | "Recording" visible |
| paused | Mute 44×44, Resume Recording 56×56, **Stop Recording 64×44** (visible text "Stop") | "Paused" visible |

- `p1-2-stop-name-stable: true` — the Stop button's accessible name is "Stop Recording" in both its Visible and Confirm variants (no behavior change; only the name is pinned).
- Status words visible at 1440 **and** 430/390/375 (`recordingWordVisible`/`pausedWordVisible` = true everywhere).
- No new live region added (see §1 rationale).

### P1-3 — empty Publish panel removed
In review at 1440 **and** 430/390/375: inspector panel count **0**, exact-"Publish" text count **0**, REC/PAUSED/Ready badge spans **0** (`p1-3-review-panel`, `reviewInspectorCount`/`reviewPublishCount`/`reviewBadgeSpans`). Screenshot: `p4b-1440-review-inspector-gone.png`.

### P1-4 — Discord out of the Export CTA path
Export modal at the platform step: `discordPresent: false`; primary CTA present (`Export YouTube — 1280×720`); guest upgrade banner present. Discord is gated to `step === 'done'` (post-success only); the failure path returns to `platform`. Screenshot: `p4b-export-no-discord.png`.

### P1-5 — "Log in" opens sign-in; auth architecture preserved
| Surface | aria-label | h2 | Google | Actions |
|---------|-----------|----|--------|---------|
| Desktop, Log in clicked | "Enter your email" | "Enter your email" | **absent** | Log in, Back to all options |
| Desktop, back → chooser | "Create New Profile" | "Create New Profile" | **present** | …, Log in switch link |
| Mobile (390), Log in clicked | "Enter your email" | "Enter your email" | **absent** | same |
| Mobile, back → chooser | "Create New Profile" | "Create New Profile" | **present** | same |

- Desktop chooser switch link effective hit **66×45** (box 41×20).
- Show-password toggles **44×44** (login + chooser, desktop + mobile).
- Register-intent routing verified post-P1-8: clicking the guest upgrade CTA opens the chooser (`ariaLabel: "Create New Profile"`, Google present).
- Only an `intent` prop + step seeding was added — no changes to session handling, OAuth, or server auth flow. Screenshots: `p4b-auth-desktop-login/chooser.png`, `p4b-auth-mobile-login/chooser.png`.

### P1-6 — status pill no longer clipped behind Focus View
13 geometry probes — pill vs Focus View button, all with `overlap: false`, `inCanvas: true`:

| Viewport | State × focus | Badge top y | Focus button bottom y | Gap |
|----------|---------------|-------------|------------------------|-----|
| 1440 | recording/paused, focus on/off | 161 | 153 | 8 px |
| 430 | recording/paused, focus on/off | 377 | 373 | 4 px |
| 390 | recording/paused, focus on/off | 344 | 340 | 4 px |
| 375 | recording/paused, focus on/off | 333 | 329 | 4 px |

Pill is never hidden — it sits below the 44 px Focus View button, inside the canvas, at every breakpoint and both focus states. Screenshot: `p4b-390-recording.png` (pill fully visible under Focus View).

**Timer-mirror half of UX-006** (explicitly out of P1-6's scope per the brief; probed anyway to decide): `document.elementsFromPoint` across the top-right glyph band resolves to `VIDEO.absolute.inset-0.w-full` as topmost at every sample point; **zero** DOM nodes contain the glyph text; the timer element is unclipped (`clippedBy: null`, rect x=318 y=305, 33×16, with `[timer span, timer container, VIDEO, canvas]` stack). The "mirrored glyphs" are drawn **inside the fake camera feed** — a test-environment artifact, not an app element or a clipped timer. Recorded in §7.

### P1-7 — touch targets
**Zero `ok:false` entries across all 12 target sweeps** (landing ×7 viewports, studio 1440/1280, mobile drawer 430/390/375). Gate: effective hit ≥ 40×40.

Landing (values at 1440; every viewport swept clean — representative mobile values in parentheses):

| Target | Box | Effective hit |
|--------|-----|---------------|
| header logo | 165×23 | **182×44** (375: 170×24 → 187×45) |
| nav pills Studio / How It Works / Pricing | 40 h | 40 h |
| header Log in / Start Free | 72×40 / 94×40 | = box |
| hero Start Recording — Free / See how it works | 42 h | = box (mobile 48) |
| billing 1 month / 1 year | 90×42 / 144×42 | = box (mobile 40) |
| pricing Get Started / Get Creator | 262×40 | = box (mobile 46) |
| footer Terms / Privacy | 35×18 / 42×18 | **51×41 / 59×41** (mobile 52×41 / 59×41) |

Studio 1440/1280:

| Target | Box | Effective hit |
|--------|-----|---------------|
| header logo / Log in | 41 / 55×44 | = box |
| IconRail New Video / Recordings / Shortcuts | 40 h | = box |
| device Camera/Mic selects / refresh | 40 h / 40×40 | = box |
| inspector section headers Script/Teleprompter/Camera | 18 h | **234×43** |
| Clear | 30×18 | **47×41** |
| align left/center/right | 75×40 | = box |
| inspector selects (font, inspiration) | — | h 40 |

Mobile drawer (430/390/375, drawer verified open **and** closed — backdrop unmounted + panel translated fully off-screen):

| Target | Effective |
|--------|-----------|
| section headers ×3 | 266×43 (430: 294×43) |
| Clear | 47×41 |
| align left | 86×40 |
| device selects / refresh | 40 h / 40×40 |

Auth: show-password **44×44**; chooser "Log in" switch link **66×45** effective.

Transport (already ≥44, unchanged sizes confirm the floor): Mute 44×44, Pause 44×44, Stop 56×56, Resume 56×56, armed Stop 64×44.

Gap probe (`p4b-gap-probe.mjs`) — the two target groups the main probe didn't cover:

| Target | Box | Effective hit |
|--------|-----|---------------|
| Preview chips YouTube/TikTok/Instagram/LinkedIn (review, 1440) | 94×30 … 162×32 | **95×41 … 163×41** |
| Same chips at 390 | same | **41 h** |
| Mobile burger menu: Close menu | 44×44 | 45×45 |
| Mobile burger menu: Studio / How It Works / Pricing links | 296×56 | 297×57 |
| Mobile burger menu: Log in / Start Recording — Free | ≥44 | ≥45 |

The chip row was the **one P1-7 miss found during verification**: the chips' `after:-inset-y-[5px]` was being clipped by the row's `overflow-x-auto` (which computes `overflow-y: auto`), leaving an effective hit of only 33 px. Fixed by adding `py-1.5` to the row so the expansion stays inside the scroll container, then re-measured to 41 px at both widths (chip visuals unchanged — see `p4b-390-chips.png`).

### P1-8 — consequence-explicit payment CTA
Guest upgrade CTA text: **"Create account to purchase"** (`p1-8-upgrade-cta`). Clicking it opens the register-intent AuthModal (`ariaLabel: "Create New Profile"`, Google present) — guests are never silently charged and never hit a bare "Continue". Signed-in variant "Buy Creator access" asserted by e2e (`p0`, `workflow-ownership`). PricingModal copy untouched. Screenshots: `p4b-upgrade-cta.png`, `p4b-register-after-upgrade.png`.

---

## 5. Responsive / accessibility / behavior checklist

| Check | Result |
|-------|--------|
| Console errors | **0** across the entire probe (landing ×7, studio flows, auth ×2 viewports, export, library) |
| Horizontal overflow | **0 px** at every sweep point (landing ×7, studio prepare 1440/1280, mobile prepare + review ×3) |
| Focus | No focus loss observed in probes; auth modal Escape/Close verified (e2e 115/116); drawer focus-trap active while open. One focus nit found → §7 |
| Accessible names | See P1-2/P1-5 tables; every probed control has a stable, visible-heading-aligned name |
| Touch targets | §4 P1-7 — zero misses |
| Hierarchy / CTA dominance | Export modal has a single dominant CTA ("Export YouTube — 1280×720") with the Discord promo out of the path; upgrade prompt's only primary CTA states its consequence; landing hero keeps its primary/secondary pair (audit flagged neither) |
| Modal behavior | Welcome dismissal; auth open/Escape/Close; export modal; upgrade prompt → auth handoff; inspector drawer opens and closes via Close button, Escape, and backdrop click (all three verified: backdrop unmounted + panel off-screen; `p4b-verify` `drawerOpen=true`/`drawerClosed=true` at 430/390/375) |
| Bottom navigation present on mobile | `nav[aria-label="Compact navigation"]` visible at 430/390/375 |

---

## 6. Journeys re-run (Phase 4A's 12, at 1440)

All green in `p4b-verify.json`:

1. `1-landing` — landing loads, overflow 0
2. `2-welcome-dismissed` — welcome modal dismissed
3. `3-prepare` — camera stream attached (`readyState 4`), overflow 0
4. `4-script` — script input renders in teleprompter
5. `5-6-recording` — record → names + status words correct
6. `7-paused` — pause/resume/stop names stable, "Paused" word visible
7. `8-stopped` — stop → review appears
8. review checks (`p1-3-review-panel`) — inspector/Publish/badge absent
9. export checks (`p1-4-export-modal`) — Discord absent, CTA present
10. upgrade checks (`p1-8-*`) — new CTA + register routing
11. `11-library` — library navigation
12. `12-new-video` — new-video reset

Plus **mobile record cycles at 430/390/375** (prepare → drawer sweep → record → pause → stop → review probes) and **auth journeys at desktop + mobile** — all steps passed with no failures.

---

## 7. Observed but Deferred (P2 — not fixed, per scope)

1. **Mobile Focus View button is unnamed below `sm`.** Its label text uses `hidden sm:inline` and the button has no `aria-label`, so on mobile it is an icon-only control with an empty accessible name. (Seen while working on P1-6; fixing it would exceed the brief.)
2. **TransportBar "OK?"/"Confirm" visuals** are still 10 px. P1-2 fixed the accessible names only, explicitly leaving the visual change out of scope.
3. **Timer-mirror glyphs (audit UX-006's other half).** Probed: the glyphs render inside the `<video>` element — they are the **fake camera feed**, not app DOM; the timer itself is unclipped. Environment artifact, not a product defect; the brief scoped P1-6 to the pill regardless.
4. **Closing the mobile drawer leaves focus inside the off-screen panel** (`drawer-close-probe`: `focusInPanel=true` after Close/Escape; the closed drawer stays mounted and focusable). Pre-existing focus-management behavior, untouched by Phase 4B.
5. **The audit's remaining P2 findings** stay unimplemented by design — only the 8 P1s were in scope.

---

## 8. Evidence artifacts

`%TEMP%\opencode\ui-audit\`:

- `p4b-verify.mjs` → `shots\p4b-verify.json` — primary JSON evidence (targets ×12 viewports, contrast, journeys, auth, badge geometry, console) + `p4b-*.png` screenshots (1440 recording/paused/review, export-without-Discord, upgrade CTA, register handoff, library, 430/390 drawers, 390 recording/focus-on/paused/review, desktop+mobile auth)
- `p4b-gap-probe.mjs` → `shots\p4b-gap-probe.json` — preview chips (1440 + 390), mobile burger menu, mobile auth chooser link targets, plus screenshots `p4b-390-chips.png`, `p4b-390-burger.png`, `p4b-390-auth-chooser-links.png`
- `timer-glyph-probe.mjs` — P1-6 timer-mirror DOM probe output
- `drawer-close-probe.mjs` — drawer close via button/Escape/backdrop
- `camera-drawer-probe.mjs` — camera attach + drawer no-effect check
- Playwright chromium suite output (streamed shell log)

---

## 9. Verdict

**PHASE 4B — CERTIFIED GREEN**

Confirmed at the exact final state of the working tree:

- **All 8 P1s implemented and verified** (§4), including the chip hit-area fix found and closed during verification.
- **Gates (§2):** `tsc` 0 errors · ESLint 0 errors (21 pre-existing warnings) · Vitest **1067/1067** · Chromium Playwright **138 passed, 3 skipped (environmental), 0 failed**.
- **Browser verification:** canonical probe `failedSteps: []` / `targetFails: []` / `consoleErrors: 0` across all seven viewports — zero contrast misses, zero touch-target misses, zero overflow, pill unclipped at 430/390/375, names/CTA/auth gates all green.
- **All 12 journeys re-run clean** (§6), plus mobile record cycles and desktop+mobile auth journeys.
- Deferred observations recorded in §7; no P1 required a decision beyond the audit; no commits or pushes were made.
