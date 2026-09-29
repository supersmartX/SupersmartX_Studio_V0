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
| Cloud (R2) uploads | 3 files / 500 MB | unlimited |
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
