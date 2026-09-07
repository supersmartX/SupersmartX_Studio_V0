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
| `GITHUB_CLIENT_ID` | *(optional)* | `your-github-id` | GitHub OAuth |
| `GITHUB_CLIENT_SECRET` | *(optional)* | `your-github-secret` | GitHub OAuth |
| `RESEND_API_KEY` | *(optional)* | `your-resend-key` | Email sending |
| `RESEND_FROM_EMAIL` | *(optional)* | `noreply@yourdomain.com` | Email sender |
| `R2_ACCOUNT_ID` | *(optional)* | `your-cloudflare-account` | R2 storage |
| `R2_ACCESS_KEY_ID` | *(optional)* | `your-r2-access-key` | R2 storage |
| `R2_SECRET_ACCESS_KEY` | *(optional)* | `your-r2-secret` | R2 storage |
| `R2_BUCKET_NAME` | *(optional)* | `your-bucket-name` | R2 storage |
| `CASHFREE_APP_ID` | *(optional)* | `your-cashfree-id` | Payments |
| `CASHFREE_SECRET_KEY` | *(optional)* | `your-cashfree-secret` | Payments |
| `CASHFREE_ENV` | `sandbox` | `production` | Payments environment |

### Pre-Deploy Checklist

- [ ] `NEXTAUTH_SECRET` is a strong random string (≥32 chars, generated via `openssl rand -base64 32`)
- [ ] All production secrets rotated from any previously committed values
- [ ] `.env` file has NO real credentials — only `.env.local` (which is gitignored)
- [ ] Turso database exists and `TURSO_AUTH_TOKEN` is valid
- [ ] `CLEANUP_SECRET` is set for the cleanup API endpoint

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
3. Unit tests: 145+ passed, 0 failed
4. Next.js build: successful

---

## 4. Database Migrations

Migrations run automatically on first request via `ensureMigrated()` with a promise-based lock.

**Schema versions:**
- v1: `users`, `reset_tokens`, `schema_meta`
- v2: `user_stats`
- v3: `exports`, `export_jobs`
- v4: `export_jobs.job_id` column
- v5: `processed_webhooks`
- v6: `users.failed_login_attempts`, `users.locked_until`

**Migration safety:**
- All ALTER TABLE statements are wrapped in try/catch
- Duplicate column errors are silently skipped
- Migrations are idempotent — safe to run multiple times

**Pre-deploy verification:**
```bash
# Test migration against fresh database
TURSO_DATABASE_URL="file:data/test-migration.db" npx vitest run src/__tests__/exports-db.test.ts
```

---

## 5. Secrets Management

| Secret | Where to Set | How to Rotate |
|--------|-------------|---------------|
| `NEXTAUTH_SECRET` | Vercel env | Generate new, redeploy |
| `TURSO_AUTH_TOKEN` | Vercel env | `turso db tokens create` |
| `CLEANUP_SECRET` | Vercel env | Generate new, redeploy |
| Google OAuth | Vercel env | Google Cloud Console |
| GitHub OAuth | Vercel env | GitHub Settings |
| Resend API Key | Vercel env | Resend dashboard |
| Cashfree Keys | Vercel env | Cashfree dashboard |
| R2 Keys | Vercel env | Cloudflare dashboard |

**Rules:**
- Never commit `.env` or `.env.local` to version control
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
3. Run cleanup: `POST /api/export-jobs/cleanup` with `x-cleanup-secret` header

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
