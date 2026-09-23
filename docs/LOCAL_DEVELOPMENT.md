# Local Development

## Prerequisites

- Node.js 20 (see `.github/workflows/ci.yml` `NODE_VERSION`)
- npm (lockfile `package-lock.json` committed)

## Setup

```powershell
npm ci
Copy-Item .env.example .env.local   # then fill values, see ENVIRONMENT.md
npm run dev                          # http://localhost:3000
```

Local DB needs no env vars: SQLite file at `data/supersmartx.db`
(auto-created). R2/Cashfree/Resend features degrade gracefully when
unconfigured (503 `Storage not configured`, local-export fallback).

## Verification (same order as CI)

```powershell
npm run lint
npx tsc --noEmit
npm test            # vitest, 406 tests
npm run build
npm run test:e2e    # needs browsers: npx playwright install; uses build output
```

## Useful details

- Auth secret: any 32+ char string in `.env.local` (`NEXTAUTH_SECRET`).
- Google OAuth is optional; Credentials login works without it.
- `TURSO_DATABASE_URL=file::memory:` is used by tests (see `src/__tests__`).
- Never commit `.env.local` (gitignored).
