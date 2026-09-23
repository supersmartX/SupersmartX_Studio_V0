# Deployment

Target: Vercel (`vercel.json` cron included). Any Next.js 16-capable host
works if cron and env are provided equivalently.

## Promote checklist

1. Set ALL production env vars (ENVIRONMENT.md), especially `NEXTAUTH_SECRET`,
   `NEXT_PUBLIC_APP_URL` (= canonical `https://studio.supersmartx.com`),
   Turso pair, Cashfree pair + mode, R2 quartet.
2. CI must be green: lint → typecheck → test → e2e → build
   (`.github/workflows/ci.yml`; e2e/build wait for the first three).
3. `npm run build` must pass with no missing-env warnings except knowingly
   optional ones.
4. Database migrates automatically on first request (`ensureMigrated`);
   v10 rebuilds `exports`/`user_stats` in place — safe to roll forward,
   no manual step.
5. Vercel cron `POST /api/export-jobs/cleanup` (`0 2 * * *`) requires
   `CLEANUP_SECRET` header config.
6. Domain: apex + www redirect to `studio.` (see `next.config.ts`
   redirects); HSTS preload is enabled — only serve HTTPS.

## Post-deploy smoke

- `GET /api/health` → ok.
- Signup → login → logout; wrong-password ×6 → lockout message.
- Free: 720p YouTube export succeeds locally; Instagram format rejected 403.
- Creator (sandbox order + webhook): 1080p presigned upload → complete →
  download URL works, then expires.
- Password reset invalidates old sessions.
