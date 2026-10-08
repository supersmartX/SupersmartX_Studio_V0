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
| `TURSO_DATABASE_URL` | *(auto local SQLite)* | `libsql://*.turso.io` | Database URL |
| `TURSO_AUTH_TOKEN` | *(none)* | `your-turso-token` | Database auth |
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
- [ ] Turso database exists and `TURSO_AUTH_TOKEN` is valid
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

### Turso Database (Production)

```bash
# Create Turso database
turso db create supersmartx-studio-prod
turso db tokens create supersmartx-studio-prod

# Set in Vercel
vercel env add TURSO_DATABASE_URL production
# Value: libsql://supersmartx-studio-prod.turso.io

vercel env add TURSO_AUTH_TOKEN production
# Value: <your-token>
```

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

Migrations run automatically on first request via `ensureMigrated()` with a promise-based lock.

`src/lib/db/schema.ts` holds migrations as **version-grouped** statement lists
(`{ version, statements[] }`), not one flat array. `schema_meta.schema_version`
is a *version*, never an index into an array — appending a group therefore
cannot replay an older group's statements.

**Schema versions:**
- v1: `users`, `reset_tokens`, `schema_meta`
- v2: `user_stats`
- v3: `exports`, `export_jobs`
- v4: `exports.job_id` column
- v5: `processed_webhooks`
- v6: `users.failed_login_attempts`, `users.locked_until`
- v7: `pending_orders`
- v8: `users.session_version`
- v9: `monthly_export_counts`
- v10: `exports` / `user_stats` rebuild to add `ON DELETE SET NULL` / `CASCADE`
- v11: `daily_recording_seconds`
- v12: `order_notifications`
- v13: `deleted_identities` (account-deletion session tombstone)

**Migration safety:**
- Only groups with `version > stored version` are applied
- Each version group is applied as **one transaction** (`db.batch(..., 'write')`),
  and the version stamp travels inside that same batch. A group therefore either
  applies completely and records its version, or does neither — an interrupted
  run restarts from the last fully applied version with the schema untouched
- Any error aborts and surfaces the version it failed at. There is no
  "duplicate column, carry on" leniency: every `CREATE` in the ledger is
  `IF NOT EXISTS` and every `DROP` is `IF EXISTS`, so a duplicate error can only
  mean the stored version disagrees with the real schema — an inconsistent
  database that must stop the deploy loudly
- A failed schema-version *read* throws instead of falling back to 0 — treating
  an unreadable database as empty would replay every migration over live data
- A stored version newer than the build is refused
- Copy/swap migrations (v10, which drops and rebuilds `exports` and `user_stats`)
  are safe because the group is atomic: it cannot fail between the `DROP` and
  the `RENAME`

**Adding a migration:** append a new group with the next version.
`SCHEMA_VERSION` is derived from the last group — never renumber or edit an
existing group.

**Pre-deploy verification:**
```bash
# Test migration against fresh database
TURSO_DATABASE_URL="file:data/test-migration.db" npx vitest run src/__tests__/exports-db.test.ts

# Regression suite for the version-keyed runner (v12 -> v13 upgrade, data survival)
npx vitest run src/__tests__/db-migrations.test.ts
```

---

## 5. Secrets Management

| Secret | Where to Set | How to Rotate |
|--------|-------------|---------------|
| `NEXTAUTH_SECRET` | Vercel env | Generate new, redeploy |
| `TURSO_AUTH_TOKEN` | Vercel env | `turso db tokens create` |
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
| Turso Dashboard | Database metrics | MEDIUM |
| Sentry (optional) | Error tracking | MEDIUM |
| UptimeRobot (optional) | Uptime monitoring | LOW |

### Key Metrics to Monitor

- API response times (p50, p95, p99)
- Database query times
- Failed login attempts (lockout events)
- Export job success/failure rates
- Storage usage (R2 + SQLite)

---

## 10. Failure Recovery

### Scenario: Database Unavailable

**Symptoms:** Health check returns 503, "database" check shows error

**Recovery:**
1. Check Turso status: `turso db show supersmartx-studio-prod`
2. If Turso outage: wait for Turso to recover (auto-reconnects)
3. If token expired: generate new token, update Vercel env, redeploy
4. If corruption: restore from Turso backup

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
