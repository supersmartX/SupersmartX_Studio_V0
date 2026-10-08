# Entitlements (Plan Contract)

Single source of truth: `src/lib/entitlements.ts`. Customer-facing plans:
`free`, `creator_monthly`, `creator_yearly` (`pro_*` exist for backward
compatibility only and are not sold).

| Capability | Free | Creator |
| ---------- | ---- | ------- |
| Export / download | yes (local unlimited) | yes |
| Max resolution | 720p (1280×720, server-clamped) | 1080p, orientation-independent envelope |
| Recording budget | 600 s/day; 180 s per teleprompter session | unlimited |
| Platforms | YouTube 16:9 only (server-rejected otherwise) | all 7 launch formats |
| Crop & reframe | no (server-rejected) | yes |
| Watermark | required | no |
| Cloud (R2) uploads | none — local/device-only (owner decision 2026-10-07) | unlimited |
| Voice speech-follow teleprompter | no | yes (CR-002; Guest = no) |
| Monthly export quota | n/a (local) | unlimited |

## Launch platform matrix

`src/constants/index.ts` holds two views. `PLATFORM_PRESETS` is canonical and
includes a `custom` entry kept for backward compatibility; `LAUNCH_PLATFORM_PRESETS`
is derived from it and is the only view the UI or any API route may use.

| id | Label | Output |
| -- | ----- | ------ |
| `youtube-landscape` | YouTube | 1920×1080 |
| `youtube-shorts` | YouTube Shorts | 1080×1920 |
| `instagram-reels` | Reels | 1080×1920 |
| `tiktok` | TikTok | 1080×1920 |
| `linkedin` | LinkedIn | 1080×1920 |
| `instagram-post` | Instagram Square | 1080×1080 |
| `instagram-portrait` | Instagram Portrait | 1080×1350 |

`custom` is not purchasable, not selectable, and is rejected by
`/api/export-jobs`, `/api/export-upload`, `/api/exports/presigned-put`, and
`/api/exports/complete`.

## Resolution clamping

`clampResolution(width, height, max)` is the shared client/server geometry helper
and `exceedsResolutionLimit` is its predicate. A limit of 1920×1080 is an
**orientation-independent envelope**: a preset is within it when each axis fits
the envelope after rotating, so 1080×1920 (portrait) is legal while 1920×1080
(landscape) is too. Comparing axes independently without rotating rejects valid
portrait presets.

Rules for maintainers:

- Add new limits ONLY in `getEntitlements` + enforce in the route handler.
  Client values (`outputWidth`, `duration`, `platformId`, `crop`) are inputs
  to be clamped/rejected, never authorities.
- Output dimensions are derived from the server preset. Client-supplied output
  dimensions are ignored or must match the clamped preset exactly.
- `isPlanActive(expiresAt, plan)`: free is always active; paid without a
  future expiry fails CLOSED (treated as expired).
- Prices live in `src/lib/pricing.ts`; `/api/cashfree/order` resolves price
  by server geo header (client country is a dev-only fallback) and the
  webhook re-verifies amount/currency against `pending_orders`.
- The platform is chosen once, in the Studio's "Preview as" switcher, and the
  export dialog only confirms that choice.
- Tamper regression tests: `src/__tests__/server-authoritative.test.ts`,
  `src/__tests__/entitlements.test.ts`,
  `src/__tests__/export-platform-matrix.test.ts`,
  `src/__tests__/platform-selector.test.tsx`.

## Phase 4 reconciliation (doc ↔ `src/lib/entitlements.ts`)

Reviewed field-by-field against the implementation. Where they disagree, the
mismatch is **reported here, not silently fixed on either side** (FC-1.1 §14
applies by analogy; see `CHANGE-CONTROL.md` and `TRACEABILITY.md` findings).

Per-plan status. `creator_monthly` and `creator_yearly` are byte-identical in
`ENTITLEMENTS` (same nine fields), so "Creator" in the table above covers both
billing periods; only billing/expiry differ.

| Dimension | Free (code) | Creator Monthly / Annual (code) | Verdict |
| --------- | ----------- | ------------------------------- | ------- |
| Recording duration per take | 600 s (`maxDurationSeconds`) | unlimited (`null`) | **MATCH** |
| Daily recording budget | 600 s/day (`FREE_DAILY_RECORDING_SECONDS`) | unlimited | **MATCH** |
| Teleprompter session limit | 180 s/take (`FREE_SESSION_TELEPROMPTER_SECONDS`), never more than remaining daily budget; prompter hides, camera keeps rolling | unlimited teleprompter | **MATCH** |
| Max resolution | 1280×720 (`FREE_RESOLUTION`, server-clamped) | 1920×1080 orientation-independent envelope | **MATCH** |
| Watermark | required (`watermarkRequired: true`) | not required | **MATCH** |
| Platform formats | `youtube-landscape` only (`isPlatformLockedForUser`) — all other presets `403` on `/api/export-jobs`, `/api/exports/presigned-put`, `/api/export-upload`, `/api/exports/complete` | all 7 launch presets (`custom` rejected everywhere) | **MATCH** |
| Crop & reframe | `canCrop: false` → `403` | `canCrop: true` | **MATCH** |
| Exports (count) | unlimited local (`maxExportsPerMonth: null`, `canExport: true`) | unlimited (`null`) | **MATCH** |
| Downloads | unlimited (`maxDownloads: null`) | unlimited | **MATCH** |
| Cloud (R2) library | owner decision 2026-10-07: **Free is local/device-only** — `maxUploads: 3`, `maxStorageMB: 500` retired to `null` in `entitlements.ts`; both cloud upload routes keep rejecting Free with `403 "Free plan uses local export"` before any quota check (`presigned-put` L41–43, `export-upload` L48–50) | unlimited (`null`) | **RESOLVED (F-01, Phase 5 WS-C)** — table row and code now agree: no Free cloud quota exists |
| Voice speech-follow teleprompter | **no** (Guest = no) | **yes** — implemented in Phase 5 (WS-B) per CR-002; claims in `user-journey.md` (L97/392/581), `UpgradePromptModal.tsx:23`, `JsonLd.tsx:75`, `constants/index.ts:37`, `email.ts:46` become true by implementation | **RESOLVED (F-02/F-15, CR-002)** — feature implemented and covered by tests |

Notes:

- `pro_monthly` / `pro_yearly` are identical to Creator and are not sold
  (backward compatibility only).
- `isPlanActive`: free is always active; a paid plan with a missing or past
  expiry fails **closed**.
- Free *can* create an export job (`/api/export-jobs` allows `canExport: true`)
  but can never obtain a staging key (both upload routes 403 first), so Free's
  only functioning export path is local export.
