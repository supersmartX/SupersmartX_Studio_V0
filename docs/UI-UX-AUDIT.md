# SupersmartX Studio — UI/UX Audit

> **AUDIT ONLY — no product changes were made.** No implementation, no refactor, no dependency
> changes, no commits, no pushes. This document is the evidence base for deciding what to fix first.

**Date:** 2026-10-07 · **Scope:** complete user-facing surface of SupersmartX Studio (`src/app/`, `src/components/`, `src/hooks/`, `src/styles/`, Storybook)
**Method:** 4 parallel code audits (file:line) + real browser review via Playwright headless Chromium
(fake camera/mic flags, permissions granted) against `next dev` on `localhost:3000`.

**Evidence runs (all artifacts under `%TEMP%\opencode\ui-audit\`):**

| Tag | Run | Artifact | Result |
|---|---|---|---|
| [J] | 12-journey desktop walkthrough @1440×900 | `shots/journeys.json` + 13 PNGs | 13/13 steps OK, **0 console errors** |
| [R] | Responsive sweep, 8 viewports × landing+studio | `shots/responsive.json` + 16 PNGs | `overflowX = 0` at every viewport |
| [D] | Transport footer DOM dumps (idle/recording/paused @390) | `shots/diagnose.json` | aria-label inventory |
| [C2] | Mobile record cycle + Auth @375 measurement | `shots/final-captures.json` | card 343×731, 0 inputs below fold |
| [C3] | Review → locked chip → upgrade → export | `shots/capture3.json` | guest upgrade chain traced |
| [C4] | Export modal copy + controls inventory @1440/390 | `shots/capture4.json` | full text dump, both sizes |
| [C5] | Upgrade/pricing modal copy + Export @375 scroll | `shots/capture5.json` | modal fits, internal scroll works |
| [MATH] | WCAG contrast computation on theme tokens | (computed in-run) | see §7 |
| [GREP] | Source greps for labels/tokens/dialogs | (in-run) | see §7–§8 |

Caveats: headless Chromium with **fake** camera devices — real-device permission denials, hardware
glitches and true touch input were **not** exercised (see §12). Screenshot files referenced below
live in `%TEMP%\opencode\ui-audit\shots\`.

---

## 1. Executive Summary

**No P0 issues observed** — every scripted journey completed end-to-end with zero console errors,
zero horizontal overflow, and no blocked task. The product's *structure* is sound; the damage is
concentrated in **a handful of high-visibility surfaces**.

**Top 10 highest-impact UX issues:**

1. **The review phase's "Publish" inspector panel is an empty shell** — a header, a close button,
   and nothing else, sitting next to the product's most important moment (post-recording). It reads
   as broken. [SHOT `09-review-1440.png`]
2. **The Export modal embeds a Discord community promo + feedback form directly beneath the Export
   CTA** — a second full-width button in a different brand color inside a task dialog, competing
   with the one action the user came to perform. [C4]
3. **Header "Log in" opens the "Create New Profile" registration form** — sign-in intent lands on
   sign-up, and the dialog's `aria-label` logic labels non-chooser steps "Enter your email"
   (`AuthModal.tsx:147`). [J, SHOT `13-auth-modal.png`]
4. **`--color-text-muted: #52525B` fails WCAG AA everywhere (2.44–2.57:1)** — and it is used for the
   10px **"Recording"** status label under the timer (`TransportBar.tsx:94`), quota fine print, and
   dozens of hints. The most safety-relevant status text is the least readable text in the app.
   [MATH, GREP]
5. **The pause button has no accessible name**, the paused-state Stop control's accessible name
   mutates live (`Stop → Confirm`, `TransportBar.tsx:201`), and the "Recording"/"Paused" status
   words are `hidden sm:block` — invisible on phones (`TransportBar.tsx:94,97`). [D, GREP]
6. **Canvas status overlays collide on mobile**: the REC/PAUSED pill is clipped behind the Focus
   View button, and mirrored timer glyphs are clipped by the top-right corner. [SHOT
   `S-390-recording/paused.png`]
7. **Sub-40px touch targets on primary paths**: Show-password button **16×16**, inspector selects
   153×36, alignment buttons 86×34, "Clear" 30×18 — measured on a 390px touch layout. [C2, R]
8. **Vague payment CTA**: the pricing modal's primary button is a bare **"Continue"** that leads a
   guest into account creation and payment; consequence is only in a footnote. [C5]
9. **Same action, three representations**: Export exists in the header *and* below the canvas;
   Stop exists as an icon button (aria `Stop Recording`), a text button (`Stop`), and a mutating
   label (`Confirm`). [J, D]
10. **Trust-copy tension**: the Welcome modal says recordings go to "your own private cloud
    library" while the persistent footer promises "Everything stays on your device" — both may be
    literally true, but they read as contradictory on first run. [SHOT `02-welcome-modal.png`]

---

## 2. Product Surface Map

| # | Surface | Screen / State | User Goal | Primary Action | Secondary Actions | Visible Controls | Information Hierarchy | Current UX Risk |
|---|---|---|---|---|---|---|---|---|
| A | Studio | Prepare (idle, camera ready) | Set up and start a take | Big red **Record** button (transport, 56px, only saturated object) | Type script, tune teleprompter, pick devices, mute mic | Rail (New Video/Recordings/Shortcuts), device bar, inspector cards (Script, Teleprompter, Camera), timer+quota, footer hints | Canvas → transport → inspector → chrome | ~20+ controls exposed before the first take; "0% of target" metric unexplained [SHOT 03] |
| B | Script | Editor card (prepare) | Write/paste the script | Focus textarea, type | Clear, load preset, word count | Placeholder, "Saved locally" dot, Clear, preset select, word/% row | Label → status → text → actions | "Clear" is a bare 30×18 text button (destructive, tiny); "0% of target" undefined until a platform is chosen [R, SHOT 03] |
| C | Prepare | Phase transition → countdown | Begin recording | Record | Cancel countdown | 3-2-1 overlay + **Cancel**; transport reduces to mic only [SHOT 05] | Countdown is the only focal point | GOOD: Cancel always available; transport deliberately simplified [J] |
| D | Camera preview | Live preview (prepare/recording) | See myself before/during take | — (monitoring) | Focus View toggle | Preview, resolution badge (1920×1080), eye-line guide, NATURAL EYE LINE pill, mirrored timer, REC pill | Preview dominates viewport (correct) | Overlay stack collides at ≤390: REC/PAUSED pill hidden behind Focus View; mirrored glyphs clipped (UX-006) |
| E | Teleprompter | Overlay on preview (recording) | Read script at eye line | — (automatic scroll) | Font family/size/width/height/alignment sliders (prepare) | Live text over video, eye-line band, free-plan 3-min notice | Text over face-aligned band | Free-plan limit surfaced only as a passive card notice; script-end behavior untested live [SHOT 03, §12] |
| F | Recording | Active (recording state) | Capture the take | **Stop** (2-step) | Pause, mute mic | Red dot + timer (left), mic 44px, stop 56px, pause 44px (right-of-center), quota line "Recording · N remaining" | Timer + stop cluster | Pause button unnamed for SR; "Recording" word 10px + fails contrast + hidden <640px (UX-001/005) |
| G | Pause | Paused | Review moment, resume safely | **Resume** (purple, 56px) | Stop (text button, arms → "Confirm") | Purple resume, red "■ Stop", transport "Paused" word (hidden <640) | Resume dominates (correct) | Accessible name of Stop mutates Stop→Confirm; on phones only color/shape distinguishes paused (UX-005) [D] |
| H | Completion | Stop → processing → review | Keep the take | 2-step Stop (click, then confirm ≤3s) | — | Button label swap (`Confirm`) | Auto-disarm after 3s prevents accidental stop | GOOD design; label is 10px — easy to miss the arming window (UX-005) [CODE TransportBar:50-68] |
| I | Review | Post-take workspace | Inspect take, pick platform, export | Export (purple, below canvas) | Record again, preview-as chips, Share/Export in header, mute review | Preview player, PREVIEW AS chips (lock icons on gated), "YouTube · Landscape · 16:9", Export, transport record button | Preview → chips → Export | **Publish panel empty** (UX-003); three competing "next" actions: Export(canvas), Export(header), Record (UX-009) |
| J | Platform preview | Locked chip → upgrade prompt | Understand what's locked | See price instantly: "Create for Reels · ₹349" | "Continue", "Use Free instead" | Benefit list (8 items), price, no-renewal note, account footnote | Title → benefits → price → CTA | GOOD: price + consequences before payment. CTA "Continue" is consequence-free (UX-008) [C5] |
| K | Export | Modal, step "Choose a platform" | Render the file | "Export YouTube · 1280×720" | Change format, Sign in, player controls | Guest banner, video player, platform row, CTA, "00:02 · WEBM · 0.2 MB" | Task block first (good) | **Discord promo + feedback form directly below CTA** (UX-004); title says "Choose" but shows a confirm+Change [C4] |
| L | Export progress | Encoding state | Track progress | — (wait) | Cancel | Progress bar (track uses **undefined token** `bg-surface-secondary`, `ExportModal.tsx:413`) | Progress | Track may render unstyled (GREP, §8); cancel-loss semantics not exercised live [§12] |
| M | Export success | Done state | Get the file | Download | — | Done step | Download first | Not exercised live (guest export requires encode — see §12) |
| N | Export failure | Failure state | Recover | Retry? | — | Failure copy + retry path (code-audited) | Error → retry | Copy exists in code; **live behavior unverified** — requires evidence before change [§12] |
| O | Library | Recordings (1 take) | Find my take | Preview (purple) | Export, ⋯ rename/delete | Card: thumb+play, duration pill, "Video recording" title, date/size meta | Title → meta → actions | Default title "Video recording" is generic; count duplicated top-right + bottom bar [SHOT 11] |
| P | Empty Library | 0 takes | Learn what goes here | Record | — | "No saved exports yet" + explanation copy | — | GOOD: empty states explain retention (24h/7d) [SHOT 11] |
| Q | Existing recording | Take detail / ExistingRecordingModal | Re-use an old take | Preview / choose platform | Export, rename, delete | Modal + platform choice | Platform → export | Delete/rename confirmation copy not exercised live [§12] |
| R | Settings | Inspector drawer (≤1279) / Header gear | Adjust script+teleprompter+camera | Edit fields | Sliders, selects, align buttons | Prepare drawer 360px/85vw | Sections collapsible | Touch targets 34–38px below 44 (UX-007); drawer blocks canvas (expected) [R] |
| S | Authentication | AuthModal (chooser/email/register) | Create account or sign in | Google / Create Account | Log in link, password show/hide | Two-column brand panel + form | Steps 1-2-3 left, form right | **"Log in" opens registration** (UX-003); dialog aria-label mismatch; Show-password 16×16 (UX-007) [J, C2] |
| T | Upgrade / payment | Pricing modal (from locked chip or Continue) | Decide if worth ₹349 | "Continue" | "Use Free instead" | Benefits, ₹349, "No automatic renewal", account-required footnote | Benefits → price → CTA | Bare "Continue" (UX-008); for guests it routes to auth — nested dialog stack (Escape twice) [C3, C5] |
| U | Error / recovery | Camera/mic denied, stream lost, quota exceeded | Get back to working | Retry (InitOverlay error states) | — | InitOverlay `idle/requesting/ready/error`, toasts, quota line | Error near the cause | Code-verified states exist; **not exercised without real permission denial** — evidence gap [§12] |
| V | Responsive | 1440→375 (8 viewports) | Same tasks at any size | unchanged | Drawer opens ≤1279 | Rail ≥1280; BottomNav <1280; burger <900 (landing); drawer 360px/85vw | Shell re-composes intentionally | `overflowX=0` everywhere ✓; residual: touch targets, canvas pill collision, transport asymmetry [R] |

---

## 3. Critical Issues (P0/P1 only)

**P0: none.** All 12 scripted journeys completed; no task was blocked in tested conditions.

### UX-001 · P1 · Accessibility · Global status & hint text
- **Surface:** Transport status ("Recording", `TransportBar.tsx:94`), quota fine print, inspector hints, `text-muted` labels app-wide.
- **User impact:** Low-vision users and everyone on a dim screen cannot read the app's primary state labels; WCAG AA fail on normal text.
- **Current behavior:** `--color-text-muted: #52525B` on `--color-surface: #111113` = **2.44:1**; on `--color-canvas: #09090B` = **2.57:1** (AA requires 4.5:1). Applied to `text-[10px]` status labels (`TransportBar.tsx:94`, quota note), making the "Recording" word under the timer effectively invisible. [MATH, GREP]
- **Why it is a problem:** The single most safety-relevant question ("am I recording?") is answered by the least legible text in the UI; AA compliance failure.
- **Evidence:** [MATH] ratio table; `globals.css:29`; `TransportBar.tsx:94`.
- **Recommended direction:** Raise `--color-text-muted` to ≥4.5:1 on both canvas and surface (e.g., a `zinc-500`-class value), keep hierarchy by weight/size rather than sub-threshold contrast. Do not darken `--color-text-secondary` (7.36:1, GOOD).
- **Implementation complexity:** Low (single token + visual QA pass).

### UX-002 · P1 · Accessibility / State · Pause control & paused-state signals
- **Surface:** Transport bar, all recording states, all viewports.
- **User impact:** Screen-reader users cannot identify or operate pause; sighted phone users lose the "Paused"/"Recording" words entirely; SR users hear the stop control's name change mid-interaction.
- **Current behavior:** Pause button (`TransportBar.tsx:177-187`) has **no aria-label** (runtime dump confirms `aria: null`) — announced only as "button". Paused stop button text swaps `Stop → Confirm` (`TransportBar.tsx:201`) with no aria-label, so its accessible name mutates live. "Recording" (l.94) and "Paused" (l.97) are `hidden sm:block` → absent below 640px. [D, GREP]
- **Why it is a problem:** "Am I paused? Where is pause?" becomes unanswerable without sight on mobile, and unreliable via SR everywhere. Same control changing its own name breaks SR context.
- **Evidence:** `diagnose.json` footer dumps (idle: 2 buttons; recording: mic/"Stop Recording"/unnamed; paused: mic/"Resume Recording"/unnamed `Stop`); source lines above.
- **Recommended direction:** Stable aria-labels for all three states (`Pause`/`Resume`/`Stop`, with `aria-pressed`-style state or a separate status region announcing paused); show status words at all breakpoints; keep the 3s arm window but make `Confirm` visible (it is currently 10px).
- **Implementation complexity:** Low.

### UX-003 · P1 · Hierarchy · Review phase "Publish" panel
- **Surface:** Inspector during Review (desktop ≥1280).
- **User impact:** The sidebar promised by the phase model shows a title ("Publish") and an empty body at the exact moment the user expects publish/export options — reads as a rendering bug, wastes 266px, and pushes users to the canvas Export by accident rather than by design.
- **Current behavior:** Panel header renders with close button; body empty in live run at 1440×900 across multiple takes. [SHOT `09-review-1440.png`, body-text probe in capture3]
- **Why it is a problem:** An empty primary panel in the product's conversion moment is the strongest possible hierarchy failure: the screen has an obvious hole.
- **Evidence:** Screenshot + `capture3.json` body text ("…Everything stays on your device Publish Space to record…" — "Publish" isolated).
- **Recommended direction:** Either populate (platform summary + Export + share actions) or collapse the panel until it has content; never render an empty titled region.
- **Implementation complexity:** Low–medium (decide content ownership; no redesign implied).

### UX-004 · P1 · Cognitive load / Composition · Discord promo inside Export modal
- **Surface:** Export modal, every export attempt, guest and signed-in.
- **User impact:** Two full-width, similarly weighted buttons (purple "Export YouTube · 1280×720" and blurple "Join Discord Server") plus a feedback input stack under the task — the user must actively ignore marketing to finish the job; error-prone for first-time users and dilutes the single-primary rule.
- **Current behavior:** Dialog body order: guest banner → player → platform row → **Export CTA** → meta → **"Connect on Discord" block with "Join Discord Server" + "OR LEAVE FEEDBACK" input + Send**. Identical at 1440 and 390. [C4, SHOT `10-export-platform.png`]
- **Why it is a problem:** Community/feedback belongs in an outro, success step, or post-export toast — not sandwiched under the primary CTA in the task dialog.
- **Evidence:** `capture4.json` text + button inventory.
- **Recommended direction:** Move Discord/feedback to export-success step or app footer; keep task dialog to task.
- **Implementation complexity:** Low (move block); medium if a success-step placement is chosen.

### UX-005 · P1 · Intent · "Log in" opens registration
- **Surface:** Header "Log in" → AuthModal, desktop + mobile.
- **User impact:** A returning user who clicks "Log in" is greeted by "Create New Profile" with First/Last name fields — wrong intent, extra cognitive detour, and the dialog `aria-label` for non-chooser steps is "Enter your email" (`AuthModal.tsx:147`) — SR hears a third, also-wrong name.
- **Current behavior:** Live run: one click on header "Log in" renders the registration screen (screenshot); subtitle "Create an account or log in" + a "Log in" text link at the bottom is the only route back. [J, SHOT `13-auth-modal.png`, GREP]
- **Why it is a problem:** Sign-in is more common than sign-up after day one; misrouting it inflates abandonment and adds three naming systems (Log in / Create New Profile / account) for one concept.
- **Evidence:** journeys step `auth-modal`; `AuthModal.tsx:107,117,147`.
- **Recommended direction:** Route header "Log in" to the sign-in step; derive the dialog `aria-label` from the visible title; unify "profile/account" terminology (§9).
- **Implementation complexity:** Low.

### UX-006 · P1 · Canvas · Overlay collisions at ≤390
- **Surface:** Canvas overlays during recording/paused, phones.
- **User impact:** The REC/PAUSED pill — the on-stage "is it recording" indicator — is half-hidden behind the Focus View button (only "…USED" visible when paused); mirrored timer glyphs at top-right are clipped by the corner. Users lose the two strongest recording cues exactly where screen space is tightest.
- **Current behavior:** Focus View button and status pill share the top-left corner; timer mirror shares top-right with the resolution/eye-line stack; both collide at 390×844. [SHOT `S-390-recording.png`, `S-390-paused.png`]
- **Why it is a problem:** The recording surface must answer "am I recording / paused?" at a glance; occlusion defeats it.
- **Evidence:** mobile screenshots + transport dumps (state visible only via button icons).
- **Recommended direction:** Give status pill an exclusive corner (or move it into the transport status cluster on mobile); stop mirroring/clipping the timer overlay.
- **Implementation complexity:** Low–medium (overlay layout rules per breakpoint).

### UX-007 · P1 · Accessibility · Touch targets below 40px on primary paths
- **Surface:** Auth form, inspector drawer, landing mid-breakpoints.
- **User impact:** Missed taps and fat-finger failures on exactly the flows that lose money/users (login, device choice, alignment).
- **Current behavior (measured):** Show-password **16×16**; inspector selects 153×**36**; align buttons 86×**34**; "Clear" **30×18**; preset selects 265×38; section headers 18px tall; landing small-target count rises to 10–12 at 1024/912. Studio keeps 12–13 sub-40px targets at every viewport. [C2, R]
- **Why it is a problem:** 44px is the platform-recommended minimum; these are not edge controls but repeated primary-path controls.
- **Evidence:** `final-captures.json` button rects; `responsive.json` smallTargets arrays.
- **Recommended direction:** Raise interactive hit areas to ≥40px (padding-only growth is enough for "Clear"/align/eye toggle); keep visuals, grow hit boxes.
- **Implementation complexity:** Low–medium.

### UX-008 · P1 · Copy / Conversion · Payment CTA "Continue"
- **Surface:** Pricing/upgrade modal (locked platform chip → prompt).
- **User impact:** The commit action toward a ₹349 payment is labeled "Continue" with no verb about money; consequence ("Account required to buy Creator access and download") sits below as fine print. Guests also get surprised by the auth modal appearing after Continue (nested dialogs; two Escapes).
- **Current behavior:** Live copy: title "Create for Reels", ₹349, "One-time payment for 1 month of access. No automatic renewal.", button **"Continue"**, secondary "Use Free instead". [C5]
- **Why it is a problem:** "Continue" hides consequence at the one step where consequence matters; the audit brief's own example of anti-pattern copy.
- **Evidence:** `capture5.json` overlay text; `capture3.json` (post-Continue = AuthModal).
- **Recommended direction:** Action-specific label ("Create account to purchase" for guests / "Pay ₹349" when signed in); surface the account requirement before the click, not after.
- **Implementation complexity:** Low (copy + one conditional label).

---

## 4. Layout & Composition

**Strengths.** The studio shell is genuinely workspace-like: 200px rail, dominant canvas, docked inspector, fixed transport — reading order top→center→bottom is obvious and the eye lands on the preview first, then the red Record button (the only saturated object in Prepare). The countdown overlay (3 + Cancel) correctly annihilates all competition. Breakpoint re-composition is *designed*, not accidental (§6). Review's preview→PREVIEW AS→Export stack is a clean linear hierarchy. [SHOT 03/05/09]

**Problems.**
- **Empty Publish panel** — a hole in the composition of the review screen (UX-003).
- **Review shows the device selector bar** (`fake_device_0`, refresh) although recording is over — device choice is irrelevant context in review [SHOT 09].
- **Transport asymmetry on mobile**: status cluster left, buttons right-of-center (record center ≈277px vs viewport center 195px at 390), ~50px dead space at right — controls "float" rather than anchor [D rects].
- **Welcome modal cards 1 & 3** have large dead space under short copy while card 2 fills — unequal content in equal-height cards [SHOT 02].
- **Library**: one card leaves ~50% of the content column empty at 1440 (grid is fine; the header count "1 recording" is then repeated in the bottom status bar) [SHOT 11].
- **Export modal vertical budget**: task content ≈80%, promo ≈20% (UX-004).
- Whitespace verdict: Prepare inspector uses full-height stacking (Script → Teleprompter → …) with *no* dead space — correct density; landing at 1024/912 clusters links tightly (small-target spike, §7). Do **not** add whitespace to the studio shell; the waste is localized to the three items above.

## 5. Interaction & State UX

**Strengths.**
- Two-step stop with 3s auto-disarm (`TransportBar.tsx:50-68`) — correct protection against accidental stops; countdown Cancel always present; mic mute has stable `aria-label` Mute/Unmute (`TransportBar.tsx:126`).
- "Saved locally" green-dot feedback on every script change; "Everything stays on your device" persistent reassurance; quota line states remaining time *and* its device-local nature.
- Locked preview chips use lock icons + muted styling — locked-ness is legible without opening anything.
- Zero console errors across all runs; Escape closes export/pricing/auth overlays in live runs.

**Problems.**
- **Paused-state signal redundancy fails on mobile**: transport "Paused" word hidden <640px, canvas pill occluded (UX-002/006) — the state survives only as button icon/color changes.
- **Arm-window visibility**: `Stop → Confirm` swap at 10px can be missed; users may think the first click did nothing (UX-002).
- **New Video resets the take context and empties the script textarea immediately** — under automation no confirmation appeared (native `confirm()` would be auto-dismissed by the harness, so *absence* is not fully proven). Script localStorage restore after reset **not verified** → §12.
- **Export failure/retry, quota-exceeded, permission-denied paths**: states exist in code (InitOverlay error mode, `useExportPipeline` failure modes) but were not exercised — no fake-permission denial was injected. §12.
- No toast/notification appeared in any journey — toast layer unexercised; inline vs toast judgment deferred.

## 6. Responsive UX

**Measured matrix (all: `overflowX = 0`, no element wider than viewport):** [R]

| Viewport | Landing | Studio shell | Inspector | Notes |
|---|---|---|---|---|
| 1440×900 | clean, 3 small targets | rail + docked aside | docked 266px | journeys all pass |
| 1280×800 | clean | rail + docked | docked | xl boundary holds |
| 1024×768 | clean, **10 small targets** | no rail, drawer | drawer 360px, right-anchored | link cluster tightens |
| 912×670 | burger present, **12 small** | BottomNav | drawer 360px | |
| 768×1024 | burger | BottomNav | drawer 360px | |
| 430×932 | burger, 5 small | BottomNav | drawer 360px | |
| 390×844 | burger | BottomNav | drawer 332px (85vw) | record/pause/stop fit; pill collision (UX-006) |
| 375×812 | burger | BottomNav | drawer 319px (85vw) | Auth fits (343×731, 0 inputs below fold); Export fits (maxH 730.8, `overflow-y:auto` internal scroll ✓) |

**Judgment:** mobile is *not* a shrunken desktop — BottomNav, drawer, hidden footer hints, hidden Share/Export header items show intentional adaptation [SHOT mobile]. Residual issues are touch-target sizes (UX-007), canvas overlay collisions (UX-006), and transport asymmetry — **not** fit problems. Smaller-than-375 phones (e.g., 375×667) untested — §12.

## 7. Accessibility

**Contrast (computed, AA normal = 4.5:1, large/UI = 3:1):** [MATH]

| Pair | Ratio | Verdict |
|---|---|---|
| text-muted `#52525B` on surface `#111113` | **2.44** | **FAIL** (UX-001) |
| text-muted on canvas `#09090B` | **2.57** | **FAIL** |
| text-secondary `#A1A1AA` on surface | 7.36 | PASS |
| text-secondary on canvas | 7.76 | PASS |
| white on accent `#7C3AED` | 5.70 | PASS |
| accent on canvas (UI/large) | 3.49 | PASS at 3:1 tier |
| success `#22C55E` on surface | 8.28 | PASS |
| error `#EF4444` on surface | 5.01 | PASS |
| warning `#F59E0B` on surface | 8.78 | PASS |

**Keyboard & semantics.**
- ✅ Global `:focus-visible` accent ring (`globals.css:187–191`); `role="dialog"` + `aria-modal` on Auth, Export, Pricing, Welcome, ui/Modal, landing overlay, inspector drawer (GREP, 8 matches).
- ✅ Escape closes the custom-overlay modals in live runs; footer shortcut hints ("Space to record", "Esc Close") + a Shortcuts panel exist.
- ⚠ `:focus-visible` applies `border-radius: 4px` to the focused element itself (`globals.css:190`) — a focused rounded avatar/card snaps to 4px (code audit A-02).
- ❌ Pause button unnamed; Stop name mutates (UX-002); Auth dialog `aria-label` = "Enter your email" on the registration screen (`AuthModal.tsx:147`); Pricing modal labeled "Choose Plan" while the visible title is "Create for Reels" (label/title mismatch).
- ❓ Focus-trap/restore parity across the three modal systems: `ui/Modal` has stack+trap; the custom overlays expose dialog roles but focus-restore on close was not verified live (code audit indicates it is absent repo-wide) → §12.

**Touch targets:** see UX-007 (16×16 show-password is the worst offender). BottomNav items measured 48–81×56 ✓; transport buttons 44/56 ✓; header Log in 51×44 ✓.

**Motion:** global `prefers-reduced-motion` catch-all (`globals.css:401–409`) + landing override (`page.tsx:447`) ✓ — covers CSS animations/transitions app-wide; JS smooth-scroll paths not evaluated.

## 8. Visual Consistency

**Design-system inventory (sampled):**
- Token layer exists and is documented (~90 `@theme` tokens; `globals.css:9`: "Raw values must NOT appear in component files") ✓. Prior token audit: **44% of component style lines token-clean; 87 raw-value lines across 28 files** — the system is defined but half-followed.
- **Bug-level inconsistency:** `bg-surface-secondary` (`ExportModal.tsx:413`) references a **non-existent token** (grep: 1 match repo-wide, no `@theme` definition) — export progress track has no intended background.
- Button heights: `h-11`(11), `h-12`(6), `h-14`(12) occurrences + `w-14 h-14` record — a hierarchy exists (44/48/56) but dialog CTAs, header buttons, and library buttons draw from different tiers without a stated rule (counts [GREP]).
- Radii: `rounded-xl` (20) dominates, `rounded-2xl` (3), plus lg/md mix — acceptable variance, no obvious twins.
- **`text-[10px]` appears 19× across 14 files** (timer captions, status words, chip labels, stop/confirm, pricing hint) — an undeclared 10px type tier that coexists with the tokenized caption scale; legibility floor issue as much as consistency.
- Platform brand colors used correctly for context (red YouTube chip, IG gradient badges) ✓; accent reserved for primary actions mostly ✓ (record is red — correct semantic exception).

## 9. UX Copy (high-value findings only)

| Where | Current | Problem |
|---|---|---|
| Pricing CTA | **"Continue"** | No consequence at payment (UX-008) |
| Auth | "Log in" → title "Create New Profile" → subtitle "Create an account or log in" | Three names for one flow (UX-005) |
| Auth left panel step 1 | "Register your identity" | Over-heavy; reads as legal/ID verification |
| Export modal title | "Choose a platform" | Screen shows one selected platform + "Change" (confirm, not choose) |
| Welcome title | "Welcome to **SUPERSMARTX** Studio" | Case differs from product mark "SupersmartX Studio" |
| Welcome card 2 vs footer | "…uploaded to your own private cloud library" vs "Everything stays on your device" | Trust-copy tension (Exec #10) |
| Quota fine print | "Device-local; may reset if site data is cleared or you switch browser profiles." | Jargon ("site data", "browser profiles") at 10px muted |
| Library take title | "Video recording" | Generic auto-name; date/title convention missing |

**GOOD copy (certified, do not churn):** "Export as guest — YouTube 16:9 included / Sign in for all formats, higher quality, and cloud library."; "One-time payment for 1 month of access. No automatic renewal."; "No saved exports yet / Videos you've exported will appear here."; "Paste or write your script here..."; "Permissions requested on first use."; empty-state retention explanations (24h recordings / 7d exports).

## 10. Cognitive Load

- **Prepare exposes too many decisions too early:** script editor + word/percent metrics + preset loader + 5 teleprompter sliders + free-plan notice + camera card + device selects + quota widget, all before the first take [SHOT 03]. The one decision that matters (Record) is visually dominant ✓, but "0% of target" is an unexplained metric and teleprompter tuning could collapse behind "Advanced" until first use.
- **Review has three competing primaries:** Export (canvas, purple), Export (header, ghost), Record (transport, red) — same action twice + a new-take action, all live simultaneously [SHOT 09]. One primary per phase is the fix direction.
- **Export modal asks the user to ignore a second CTA** (UX-004).
- **Duplicated information:** library count twice; transport timer + mirrored canvas timer.
- **GOOD:** locked chips defer platform choice ✓; phase-driven inspector collapse (Prepare→Publish re-composition) hides irrelevant cards ✓; welcome onboarding is one screen with a clear "Get Started" ✓; upgrade prompt shows benefits-before-price-before-CTA in the right order ✓.

## 11. Recommended Fix Order

*(Grouped for planning. Not implemented.)*

**QUICK WINS** (hours each, no behavior change)
1. Pause button aria-label + stable Stop/Confirm naming + show "Recording"/"Paused" words below `sm` (UX-002).
2. Raise `--color-text-muted` to ≥4.5:1 (UX-001) + spot-check the 10px status labels.
3. Remove or relocate the Discord block from ExportModal (UX-004).
4. Populate or hide the empty Publish panel (UX-003).
5. Fix `bg-surface-secondary` → defined token (`ExportModal.tsx:413`).
6. Auth header "Log in" → sign-in step; derive dialog aria-label from title (UX-005).
7. Pricing CTA consequence label (UX-008).
8. Show-password / Clear / align hit-area growth to ≥40px (UX-007, partial).

**HIGH IMPACT**
9. Mobile canvas overlay rules — exclusive status-pill corner, unclipped timer (UX-006).
10. One primary action per phase (header/canvas Export dedup; Record vs Export precedence in review).
11. Device bar hidden in review; remove duplicated library counts.
12. Touch-target pass across inspector + landing (complete UX-007).

**STRUCTURAL**
13. Unify the three modal systems (ui/Modal vs `useModalAnimation` overlays vs derived) — one focus-trap/restore + Escape + stacking contract.
14. Finish token adoption (the 87 raw-value lines / 28 files) and declare or remove the 10px type tier.
15. Define per-phase inspector content model so no panel can render empty.

**POLISH**
16. Take auto-naming; welcome card balance; "SUPERSMARTX" case; terminology sweep (Recording/Video/Take/Profile); quota fine-print plain language; transport centering on mobile; focus-visible radius preservation.

## 12. Deferred / Not Problems *(inspected and acceptable — do not reopen without new evidence)*

- **No horizontal overflow at any tested viewport** (8 sizes × landing/studio, `overflowX=0`) [R] — responsive fit is certified.
- **Shell breakpoint design** (rail ≥1280 / BottomNav+drawer <1280 / landing burger <900) — intentional and coherent [R, SHOT].
- **BottomNav touch sizes** (48–81×56), transport button sizes (44/56) — pass.
- **Dialog semantics** (`role="dialog"`, `aria-modal`) present across all 7 dialog surfaces [GREP].
- **Focus-visible ring**, **global reduced-motion**, **Escape-closes-overlay** — verified.
- **Two-step stop + 3s disarm**, **countdown Cancel**, **mic mute aria-labels** — verified working.
- **Guest value copy, pricing transparency, empty states with retention explanations** — strong; certified as-is.
- **Script "Saved locally" persistence indicator**, **quota device-local disclosure** — good patterns.
- **Library persistence**: take survived New Video (library still showed the recording) [J].
- **Zero console errors/warnings** in every run [J, R].

**Requires evidence before any change:**
1. Real permission-denial flows (camera/mic denied, no device, stream lost) — needs OS-level denial, not fake media.
2. Export failure/retry copy and cancel-loss semantics — needs a forced-failure run.
3. Native confirmation behavior of "New Video" (harness auto-dismisses dialogs) and script restore afterward.
4. Focus-trap/restore behavior of custom overlays under real keyboard navigation.
5. Phones smaller than 375×812 (SE-class) and landscape phones.
6. Toast/notification layer (no toast fired in any journey).
7. Teleprompter script-end behavior, voice-activated scrolling, and 3-min free limit wall.

---

## UI/UX AUDIT VERDICT

- **Overall UX health:** **AMBER**
- **P0 issues:** none (all journeys completed; no blocked task)
- **P1 issues:** UX-001 contrast (global) · UX-002 pause/status signals · UX-003 empty Publish panel · UX-004 Discord-in-Export · UX-005 Log-in intent · UX-006 mobile canvas collisions · UX-007 touch targets · UX-008 "Continue" payment CTA
- **P2 issues:** Export title/behavior mismatch, three competing primaries in review, device bar in review, duplicated counts, generic take names, terminology drift, welcome trust-copy tension, quota jargon, 10px type tier, `bg-surface-secondary` bug, focus-radius squash, transport asymmetry, welcome card imbalance, nested-dialog Escape stacking
- **Top 5 recommended improvements:** (1) contrast token + status-label legibility, (2) pause/stop accessible naming + mobile status visibility, (3) populate-or-remove the Publish panel, (4) evict the Discord block from the Export modal, (5) route "Log in" to sign-in + consequence-labeled payment CTA
- **Areas already strong:** responsive integrity (zero overflow, designed shell re-composition), dialog semantics, recording state machine + two-step stop, onboarding/pricing copy honesty, empty-state explanations, zero console errors
- **Areas requiring evidence before change:** §12 list 1–7 (permission denial, export failure, New Video confirm, focus restore, SE-class phones, toasts, teleprompter end behavior)
- **Ready for UI implementation:** **YES** — for the QUICK WINS and HIGH IMPACT items above (all scoped, low-risk, no product/pricing/auth/recording-architecture changes implied)
