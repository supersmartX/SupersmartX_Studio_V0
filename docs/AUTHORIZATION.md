# Authorization

Two layers, both mandatory:

1. **Edge gate** (`src/middleware.ts`, matcher `/api/:path*`): verifies the
   NextAuth JWT has an `id`; else 401. Public routes: `/api/auth/*`,
   forgot/reset-password, cashfree webhook, health, observe/client-error.
   Also stamps `x-request-id` on every API response.
2. **Per-route checks** (every protected route): `auth()` → `findUserById`
   → `isPlanActive` → entitlement check → **ownership-scoped query**
   (`findExportByIdAndUser`, `findExportJobByIdAndUser`).

No route trusts client-supplied user ids. R2 keys are validated against the
`exports/{userId}/` prefix in `/api/exports/complete`, and
`PATCH /api/export-jobs/[id]` rejects `resultR2Key` values outside the
caller's prefix. `exportId` path/query params reject `..` traversal.

Verified pattern (example: `GET /api/download?exportId=`): 401 unauthenticated
→ 503 storage unconfigured → 429 rate-limited → 401 unknown user → 403
expired plan / no entitlement → 404 foreign or missing export → quota consume
→ signed URL. Cross-user access returns 404 (not 403) to avoid id oracles.
