# Authentication

Stack: NextAuth v5 (Auth.js), JWT strategy, 30-day sliding expiry
(`src/auth.ts`, edge-safe base in `src/auth.config.ts`).

## Methods

- **Credentials**: email + bcrypt password (`src/lib/user-store.ts`).
  Registration validates password strength (`src/lib/validation.ts`);
  duplicate emails rejected with a generic failure (no enumeration detail).
- **Google OAuth**: enabled only when `GOOGLE_CLIENT_ID/SECRET` are set.
  First login creates a stub DB user (unusable `$oauth$` password hash) so
  `pending_orders` FK stays consistent; token id is aligned to the DB id.

## Hardening in place

- 5 failed logins → 15-minute lockout (`isAccountLocked`,
  `recordFailedLogin`).
- Password reset bumps `users.session_version`; the `jwt` callback returns
  `null` on version mismatch, killing all sessions (logout-everywhere).
- Cookies: `__Secure-` prefix in production; `/api/auth/*` served
  `no-store, no-cache`.
- Security headers (CSP, HSTS, frame/ MIME guards) in `next.config.ts`.
- Error surfaces are generic (`Unauthorized`, `Failed`) — no stack traces,
  DB errors, or user-enumeration oracles.

## Session shape

JWT carries `id`, `plan` (re-derived from DB on every callback; expired paid
plans degrade to `free`), `sessionVersion`. API routes must still call
`auth()` + `findUserById` (plan is re-read, never trusted from the token
alone for quota decisions — counters use the DB row).
