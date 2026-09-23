# Entitlements (Plan Contract)

Single source of truth: `src/lib/entitlements.ts`. Customer-facing plans:
`free`, `creator_monthly`, `creator_yearly` (`pro_*` exist for backward
compatibility only and are not sold).

| Capability | Free | Creator |
| ---------- | ---- | ------- |
| Export / download | yes (local unlimited) | yes |
| Max resolution | 720p (1280×720, server-clamped) | 1080p |
| Recording budget | 600 s/day; 180 s per teleprompter session | unlimited |
| Platforms | YouTube 16:9 only (server-rejected otherwise) | all incl. custom |
| Crop & reframe | no (server-rejected) | yes |
| Watermark | required | no |
| Cloud (R2) uploads | 3 files / 500 MB | unlimited |
| Monthly export quota | n/a (local) | unlimited |

Rules for maintainers:

- Add new limits ONLY in `getEntitlements` + enforce in the route handler.
  Client values (`outputWidth`, `duration`, `platformId`, `crop`) are inputs
  to be clamped/rejected, never authorities.
- `isPlanActive(expiresAt, plan)`: free is always active; paid without a
  future expiry fails CLOSED (treated as expired).
- Prices live in `src/lib/pricing.ts`; `/api/cashfree/order` resolves price
  by server geo header (client country is a dev-only fallback) and the
  webhook re-verifies amount/currency against `pending_orders`.
- Tamper regression tests: `src/__tests__/server-authoritative.test.ts`.
