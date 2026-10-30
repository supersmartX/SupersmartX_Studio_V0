# Deployment Strategy — SupersmartX Studio

## Deployment Flow

```
Build → Validate → Test → Deploy to Staging → Validate → Approval → Production → Health Check → Monitor
```

---

## 1. Environment Configuration

### Required Environment Variables

| Variable | Local Dev | Vercel Production | Purpose |
|----------|-----------|-------------------|---------|
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | `https://your-domain.vercel.app` | App base URL |
| `NEXTAUTH_SECRET` | *(dev default)* | **Generate 32+ char random** | Session encryption |
| `NEXTAUTH_URL` | `http://localhost:3000` | `https://your-domain.vercel.app` | Auth callback URL |
| `DATABASE_URL` | local Postgres URL | Supabase **pooler** URL (`…:6543/…?sslmode=require`) | Runtime database connection (Supavisor transaction pooling) |
| `DIRECT_URL` | local Postgres URL | Supabase **direct** URL (`…:5432/…?sslmode=require`) | Session/direct connection used only by `prisma migrate` and dumps |
| `CLEANUP_SECRET` | *(none)* | `generate-random-string` | Cleanup endpoint auth |
| `ADMIN_EMAIL` | *(none)* | `admin@example.com` | Admin notifications |
| `GOOGLE_CLIENT_ID` | *(optional)* | `your-google-id` | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | *(optional)* | `your-google-secret` | Google OAuth |
| `RESEND_API_KEY` | *(optional)* | `your-resend-key` | Email sending |
| `RESEND_FROM_EMAIL` | *(optional)* | `noreply@yourdomain.com` | Email sender |
| `R2_ACCOUNT_ID` | *(optional)* | `your-cloudflare-account` | R2 storage |
| `R2_ACCESS_KEY_ID` | *(optional)* | `your-r2-access-key` | R2 storage |
| `R2_SECRET_ACCESS_KEY` | *(optional)* | `your-r2-secret` | R2 storage |
| `R2_BUCKET_NAME` | *(optional)* | `your-bucket-name` | R2 storage |
| `CASHFREE_APP_ID` | *(optional)* | `your-cashfree-id` | Payments |
| `CASHFREE_SECRET_KEY` | *(optional)* | **`required`** | PG client secret key. **Also the webhook-signing key** — see note below |
| `CASHFREE_ENV` | `sandbox` | `production` | Payments environment. Exactly `sandbox` or `production`; independent of `NODE_ENV` |
| `NEXT_PUBLIC_CASHFREE_ENV` | `sandbox` | `production` | Browser checkout environment; must match `CASHFREE_ENV` exactly |

> `CASHFREE_ENV` is checked strictly in **every** runtime, not only production. If
> it is unset, empty, or misspelt (e.g. `prodution`, `PRODUCTION`), every payment
> path — order creation, return-trip verification and the webhook — returns 5xx
> and fulfils nothing. No value is ever substituted for it.
>
> `CASHFREE_ENV` selects the Cashfree environment **on its own**; the guard does
> not consult `NODE_ENV`. A production deployment may deliberately set
> `sandbox`/`sandbox` to test against Cashfree Sandbox, and nothing will reject
> it. Switching to live payments is therefore an environment change, not a code
> change: set both variables to `production`, swap in the production App ID and
> Secret Key, and redeploy. The public value is baked in at build time, so the
> redeploy is what makes the browser pick up the change.
>
> `CASHFREE_SECRET_KEY` is also the webhook-signing key. Cashfree signs every
> webhook with the PG client secret key and publishes **no separate webhook
> secret** — there is no "Webhooks → Secret" value in the dashboard, in Sandbox
> or in Production. `/api/cashfree/webhook` therefore reads
> `CASHFREE_SECRET_KEY` and nothing else: `HMAC-SHA256(timestamp + rawBody)`
> keyed with it, compared with `timingSafeEqual`. If that key is missing the
> route refuses every event, so a paid order is never activated by webhook (only
> by the return trip). Set it in every environment.

### Cloudflare R2 bucket CORS (required for Creator export)

The Creator export path uploads the finished MP4 **directly from the browser to
R2** using a 15-minute presigned URL (`/api/exports/presigned-put` →
`PUT` → `/api/exports/complete`). No R2 credential ever reaches the browser, so
the only thing the browser needs is a bucket CORS policy that permits the
origin, the method and the `Content-Type` request header.

Apply this in the Cloudflare dashboard: **R2 → `<bucket>` → Settings → CORS
Policies → Add**.

```json
[
  {
    "AllowedOrigins": [
      "https://studio.supersmartx.com",
      "https://www.supersmartx.com",
      "https://supersmartx.com"
    ],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Rules that must hold:

- `AllowedOrigins` uses the **exact** scheme + host + optional port. No wildcard
  (`*`) and no trailing slash. Include the exact origin a customer loads the
  studio from; a mismatch fails the preflight and the upload reports
  "Connection error during the upload to R2 storage".
- `AllowedMethods` needs `PUT` (the presigned upload). `GET` is not required —
  downloads are streamed through the server as a redirect to a *separate* signed
  URL and the object is never publicly readable.
- `AllowedHeaders` must include `Content-Type`. The browser sends it on the PUT
  and the signature binds it; omitting it fails the preflight.
- Do **not** add `NEXT_PUBLIC_R2_SECRET` or `NEXT_PUBLIC_R2_ACCESS_KEY`. Any
  `NEXT_PUBLIC_*` variable is inlined into the client bundle and would ship the
  bucket credentials to every visitor.

Manual verification (the browser half cannot be proven from the server):

1. Log in as Creator on `https://studio.supersmartx.com`, record a short clip,
   export it.
2. DevTools → Network → filter `PUT`, find the `*.r2.cloudflarestorage.com`
   request. There must be a `204`/`200` **OPTIONS** preflight immediately before
   it, and the PUT must return `2xx`.
3. Cloudflare R2 → the bucket → Objects: the object under
   `exports/<userId>/<uuid>.mp4` exists and is **not** listed as publicly
   accessible.
4. The Studio library shows the export and its download returns a signed URL
   that streams the MP4.

If steps 2-4 have not been executed against the production bucket, the R2 CORS
configuration is **NOT VERIFIED** regardless of what the source says.

### Pre-Deploy Checklist

- [ ] `NEXTAUTH_SECRET` is a strong random string (≥32 chars, generated via `openssl rand -base64 32`)
- [ ] All production secrets rotated from any previously committed values
- [ ] `.env` file has NO real credentials — only `.env.local` (which is gitignored)
- [ ] Supabase project exists, and `DATABASE_URL` (pooler, `:6543`) plus
      `DIRECT_URL` (direct, `:5432`) are set for production
- [ ] `npx prisma migrate status` reports no pending migrations for that database
- [ ] `CLEANUP_SECRET` is set **and** `CRON_SECRET` is set to the same value
      (Vercel Cron Jobs send `Authorization: Bearer $CRON_SECRET`; the route
      compares it against `CLEANUP_SECRET`)
- [ ] `CASHFREE_ENV=production` exactly, and `NEXT_PUBLIC_CASHFREE_ENV=production`
      — takes live payments; for Sandbox testing set both to `sandbox` instead,
      which is equally valid on a production deployment
      — any other value makes every payment path refuse rather than run
- [ ] `CASHFREE_SECRET_KEY` is set to the Cashfree PG client secret key — it is
      also the webhook-signing key, and Cashfree publishes no separate one
- [ ] Cloudflare R2 bucket CORS is configured — see §1 "Cloudflare R2 bucket
      CORS (required for Creator export)", without which browser upload fails at the PUT

---

## 2. Infrastructure

### Supabase PostgreSQL (Production)

1. Create the project in the Supabase dashboard. Region sets latency —
   production runs in `ap-northeast-2`.
2. Open **Connect** (or *Project Settings → Database → Connection string*) and
   copy two URIs, each with `sslmode=require`:
   - **Transaction pooler** (Supavisor) — host ends `pooler.supabase.com`,
     port `6543`. This is `DATABASE_URL`.
   - **Direct connection** (session mode) — port `5432`. This is `DIRECT_URL`.
3. Set both in Vercel:

   ```bash
   vercel env add DATABASE_URL production    # pooler URI, :6543
   vercel env add DIRECT_URL production      # direct URI, :5432
   ```

4. Apply the schema from a machine that can reach the database:

   ```bash
   npx prisma migrate status    # read-only: shows what is pending
   npx prisma migrate deploy    # applies prisma/migrations in order
   ```

5. Never run `prisma db push` or `prisma migrate dev` against this project: the
   `pending_orders_one_live_per_user` partial index has no Prisma
   representation, so both report drift and `db push` would drop it. Full
   rules: `docs/DATABASE.md`.
6. Backups are provider-managed (*Database → Backups*, plus the optional PITR
   add-on). Restore into a new project and verify before any cutover —
   `docs/DATABASE.md` § *Backup and restore*.

### Cloudflare R2 (Optional — for cloud storage)

```bash
# Create R2 bucket
wrangler r2 bucket create supersmartx-exports

# Create API token with R2 permissions
# Set in Vercel:
vercel env add R2_ACCOUNT_ID production
vercel env add R2_ACCESS_KEY_ID production
vercel env add R2_SECRET_ACCESS_KEY production
vercel env add R2_BUCKET_NAME production
```

---

## 3. Build Process

```bash
# Install dependencies
npm ci

# Type check
npx tsc --noEmit

# Lint
npx next lint

# Run unit tests
npx vitest run

# Build
npm run build
```

**Build validation gates:**
1. TypeScript compilation: 0 errors
2. ESLint: 0 errors
3. Unit tests: 370+ passed, 0 failed
4. Next.js build: successful

---

## 4. Database Migrations

Prisma Migrate is the single schema authority: `prisma/migrations` plus the
`_prisma_migrations` table in PostgreSQL. The application runtime applies **no**
DDL — `ensureMigrated()` only runs `SELECT 1` and seeds the legacy
`schema_meta.schema_version` marker (`ON CONFLICT … DO NOTHING`), which
`/api/health` reports.

**Migrations:**

- `0_init` — baseline: all 12 original tables, indexes and foreign keys
  (committed in `e4e69bf`, which retired the libSQL ledger).
- `20261030150000_pending_order_lifecycle` — pending-order lifecycle columns,
  `checkout_locks`, ten CHECK constraints and the partial unique index.

**Deploy order:** schema first, then the build.

```bash
npx prisma migrate status    # read-only, from DIRECT_URL
npx prisma migrate deploy    # applies everything pending, in order
```

**Never** use `prisma migrate dev` or `prisma db push` against a database
carrying this schema. `pending_orders_one_live_per_user` is a partial unique
index, which Prisma's schema language cannot express; both commands see
permanent drift, and `db push` drops the index that prevents duplicate payable
orders. New migrations are hand-written, additive `migration.sql` files in a
timestamped directory, with `prisma/schema.prisma` kept in step.

**If `migrate deploy` fails with "relation already exists"**, the database was
created outside Prisma Migrate, so `_prisma_migrations` is empty and `0_init`
tries to re-create live tables. Verify the schema matches `0_init`, then record
the baseline once with `npx prisma migrate resolve --applied 0_init`. Never edit
a committed migration to force it through.

**Pre-deploy verification:**

```bash
# Against a disposable PostgreSQL database, not the deployed one
DATABASE_URL="<throwaway>" DIRECT_URL="<throwaway>" npx prisma migrate deploy
npx vitest run src/__tests__/db-constraints.test.ts src/__tests__/db-durability.test.ts
```

**Rollback:** no down-migrations exist; additive-only means the previous build
reads the newer schema safely. Restore a backup only for a bad data change, not
for a bad app deploy — see `docs/ROLLBACK.md`.

---

## 5. Secrets Management

| Secret | Where to Set | How to Rotate |
|--------|-------------|---------------|
| `NEXTAUTH_SECRET` | Vercel env | Generate new, redeploy |
| `DATABASE_URL` / `DIRECT_URL` (DB password) | Vercel env | Supabase dashboard → reset database password, then update both URIs and redeploy |
| `CLEANUP_SECRET` | Vercel env | Generate new, redeploy |
| Google OAuth | Vercel env | Google Cloud Console |
| Resend API Key | Vercel env | Resend dashboard |
| Cashfree Keys (incl. webhook signing) | Vercel env | Cashfree dashboard |
| R2 Keys | Vercel env | Cloudflare dashboard |

**Rules:**
- Never commit `.env` or `.env.local` to version control
- Never prefix an R2 credential with `NEXT_PUBLIC_` — it is inlined into the client bundle
- Use `vercel env add <NAME> production` for production secrets
- Rotate all credentials before first production deploy
- Document rotation schedule in team wiki

---

## 6. Deployment Order

### Vercel Deployment (Recommended)

```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Deploy to production
vercel --prod

# Or deploy to preview (staging)
vercel
```

### Deployment Sequence

1. **Pre-deploy**: Run `npm ci && npx tsc --noEmit && npx next lint && npx vitest run`
2. **Push to main**: Triggers Vercel auto-deploy
3. **Vercel build**: `npm run build` runs automatically
4. **Post-deploy**: Health check runs automatically

---

## 7. Health Checks

### Automatic Health Check

**Endpoint:** `GET /api/health`

**Response (200):**
```json
{
  "status": "healthy",
  "timestamp": "2026-09-04T12:00:00.000Z",
  "checks": {
    "database": "ok",
    "r2": "configured"
  },
  "version": "0.1.0"
}
```

**Response (503 — degraded):**
```json
{
  "status": "degraded",
  "timestamp": "2026-09-04T12:00:00.000Z",
  "checks": {
    "database": "error: connection refused"
  },
  "version": "0.1.0"
}
```

### Post-Deploy Verification

```bash
# Health check
curl -s https://your-domain.vercel.app/api/health | jq .

# Expected: {"status":"healthy","checks":{"database":"ok",...}}
```

---

## 8. Rollback Strategy

### Vercel Instant Rollback

```bash
# List deployments
vercel ls

# Rollback to specific deployment
vercel rollback <deployment-url>
```

### Database Rollback

- Schema migrations are **forward-only**
- To rollback: deploy the previous application version
- Database schema is backward-compatible (new columns have defaults)

### Emergency Rollback Procedure

1. `vercel rollback` to previous deployment (takes ~10 seconds)
2. Verify health check passes
3. Investigate issue in previous deployment logs
4. Fix forward, re-deploy

---

## 9. Monitoring

### Immediate Post-Deploy (Manual)

```bash
# Health check
curl -s https://your-domain.vercel.app/api/health

# Check Vercel function logs
vercel logs --follow

# Check for errors
vercel logs | grep -i error
```

### Recommended Monitoring Setup

| Tool | Purpose | Priority |
|------|---------|----------|
| Vercel Analytics | Performance, Web Vitals | HIGH |
| Vercel Function Logs | Server-side errors | HIGH |
| Supabase Dashboard | Database metrics, backups, PITR | MEDIUM |
| Sentry (optional) | Error tracking | MEDIUM |
| UptimeRobot (optional) | Uptime monitoring | LOW |

### Key Metrics to Monitor

- API response times (p50, p95, p99)
- Database query times
- Failed login attempts (lockout events)
- Export job success/failure rates
- Storage usage (R2 objects + database size)

---

## 10. Failure Recovery

### Scenario: Database Unavailable

**Symptoms:** Health check returns 503, "database" check shows error

**Recovery:**
1. Check Supabase status (project dashboard + status page) and confirm
   `DATABASE_URL` still points at the pooler host; an authenticated
   `/api/health` shows `checks.db_host`, which proves the binding without
   printing the credential.
2. Provider outage: wait for Supabase to recover; Prisma reconnects per request,
   so no restart is needed.
3. Password rotated or `DATABASE_URL`/`DIRECT_URL` wrong: update both in Vercel
   and redeploy. Production fails closed (`DATABASE_NOT_CONFIGURED`) rather than
   falling back to another database.
4. Corruption or a bad write: restore a backup into a scratch project and verify
   before cutover — `docs/DATABASE.md` § *Backup and restore*. Never repair by
   deleting `pending_orders`/`processed_webhooks` rows.

### Scenario: Auth Failure

**Symptoms:** Users can't log in, 401 errors

**Recovery:**
1. Check `NEXTAUTH_SECRET` is set and correct
2. Check OAuth provider credentials haven't expired
3. Verify `NEXTAUTH_URL` matches deployed domain

### Scenario: Export Failures

**Symptoms:** Exports stuck in "encoding" or "failed"

**Recovery:**
1. Check R2 credentials if cloud storage enabled
2. Check WebCodecs browser support (Chrome 94+, Edge 94+)
3. Run the retention sweep manually: `POST /api/export-jobs/cleanup` with an
   `x-cleanup-secret: <CLEANUP_SECRET>` header (the same route also answers
   `GET`, which is what the nightly cron uses)
4. Check `CRON_SECRET` equals `CLEANUP_SECRET` — if the nightly job 401s, stale
   jobs are never reclaimed

### Scenario: Rate Limiter Issues

**Symptoms:** Users getting 429 errors unexpectedly

**Recovery:**
- In-memory rate limiter resets on Vercel cold starts
- Expected behavior — not a bug
- For production: migrate to Upstash Redis rate limiter

---

## 11. Post-Deploy Verification Script

```bash
#!/bin/bash
set -e

BASE_URL="${1:-https://your-domain.vercel.app}"

echo "=== SupersmartX Studio Deployment Verification ==="
echo ""

# Health check
echo "1. Health check..."
HEALTH=$(curl -s "$BASE_URL/api/health")
STATUS=$(echo "$HEALTH" | jq -r '.status')
if [ "$STATUS" = "healthy" ]; then
  echo "   ✓ Health: $STATUS"
else
  echo "   ✗ Health: $STATUS"
  echo "   $HEALTH"
  exit 1
fi

# Homepage
echo "2. Homepage..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL")
if [ "$HTTP_CODE" = "200" ]; then
  echo "   ✓ Homepage: $HTTP_CODE"
else
  echo "   ✗ Homepage: $HTTP_CODE"
  exit 1
fi

# Studio page
echo "3. Studio page..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/studio")
if [ "$HTTP_CODE" = "200" ]; then
  echo "   ✓ Studio: $HTTP_CODE"
else
  echo "   ✗ Studio: $HTTP_CODE"
  exit 1
fi

# API routes
echo "4. API routes..."
for route in "/api/health" "/api/auth/signin"; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$route")
  echo "   $route: $HTTP_CODE"
done

echo ""
echo "=== All checks passed ==="
```
