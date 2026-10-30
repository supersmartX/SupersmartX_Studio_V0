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

Local DB is PostgreSQL (Supabase or any Postgres) — there is no SQLite file.
Copy the pooler URL into `DATABASE_URL` and the session/direct URL into
`DIRECT_URL` (see `ENVIRONMENT.md`), then apply the schema once:

```powershell
npx prisma migrate deploy    # applies prisma/migrations to the database
```

Use a **disposable** database for development, not the production project.
R2/Cashfree/Resend features degrade gracefully when unconfigured (503
`Storage not configured`, local-export fallback).

## Verification (same order as CI)

```powershell
npm run lint
npx tsc --noEmit
npm test            # vitest unit + route suites
npm run build
npm run test:e2e    # needs browsers: npx playwright install; webServer starts `npm run dev`
```

## Useful details

- Auth secret: any 32+ char string in `.env.local` (`NEXTAUTH_SECRET`).
- Google OAuth is optional; Credentials login works without it.
- Tests use PostgreSQL, not an in-memory database: point `DATABASE_URL` at a
  throwaway database (`src/__tests__/helpers/test-database.ts`). DB-backed
  suites are skipped when it is unset, and refused when the URL looks deployed
  (`prod`, the product name, a Supabase host) unless `ALLOW_TEST_DB=1`.
- Never commit `.env.local` (gitignored).
