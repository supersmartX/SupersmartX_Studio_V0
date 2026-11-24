# AGENTS.md — SUPERSMARTX STUDIO

**Project:** SupersmartX Studio  
**Application:** Browser-based Creator Studio & Teleprompter SaaS  
**Primary objective:** Maintain, improve and scale a reliable, production-grade SaaS platform.

---

# 1. Core Engineering Principles

Every agent working on this repository must follow these principles:

1. Understand the existing architecture before changing it.
2. Fix root causes, not symptoms.
3. Prefer extending existing services over introducing duplicate systems.
4. Preserve working functionality.
5. Never report an implementation as complete without verification.
6. Do not perform unnecessary audits, reports or planning discussions when execution is requested.
7. Implement related changes together whenever practical.
8. Add regression tests for every important bug fix.
9. Keep changes focused, maintainable and production-safe.
10. Never fabricate successful test results or provider verification.

**Execution-first rule:** When given a clear implementation task, inspect the relevant code, implement the solution, run verification and report results. Do not stop after producing recommendations.

# 2. Technology Stack

Respect the existing repository versions and architecture.

- Next.js — App Router
- React
- TypeScript
- Tailwind CSS
- Prisma ORM
- PostgreSQL
- Auth.js authentication
- Paddle Billing
- Cloudflare R2
- Resend email
- Existing background workers and webhook processing
- Existing deployment configuration

Do not upgrade frameworks, replace libraries or introduce dependencies without a concrete technical reason.

# 3. Architecture Rules

Maintain clear separation between:

**Frontend**

- UI components
- Forms
- Client state
- Loading and error states
- User interactions

**API layer**

- Authentication
- Authorization
- Request validation
- Response contracts
- Rate limiting

**Business logic**

- Domain services
- Entitlement calculations
- Billing operations
- Recording and export pipelines
- Storage operations

**Data layer**

- Prisma models
- Database transactions
- Relations
- Constraints
- Persistent state

**External integrations**

- Paddle
- Cloudflare R2
- Resend
- Background workers
- Scheduled jobs

Never duplicate business logic across frontend components and API routes.

# 4. Full-Stack Contract Rules

Every feature must follow:

Frontend → API → Authentication → Validation → Service → Database/Provider → Response → Frontend state.

Requirements:

- Frontend request fields must match API schemas.
- API responses must match frontend expectations.
- TypeScript types must represent actual server responses.
- Validate all external input.
- Enforce ownership server-side.
- Use consistent error contracts.
- Never display success before server confirmation.
- Handle timeouts and retries.
- Prevent duplicate operations.
- Keep persisted state and UI state synchronized.

Do not hide backend errors through frontend-only workarounds.

# 5. Authentication and Security

- Use the existing Auth.js architecture.
- Protect authenticated routes server-side.
- Never trust client-supplied user IDs.
- Enforce authorization independently of UI visibility.
- Verify resource ownership before reading or modifying records.
- Use persisted database roles for authorization.
- Fail closed when authorization cannot be established.
- Never expose API keys, signing secrets or credentials to browser code.
- Apply rate limits to sensitive endpoints.
- Prevent replay and duplicate operations where relevant.

# 6. Paddle Billing Architecture

Paddle is the existing billing provider and Merchant of Record.

**Critical rule: Extend the existing billing system. Never build a second billing architecture.**

Preserve existing Prisma models and services, including:

- `billing_account`
- `billing_transaction`
- `billing_reservation`
- `billing_operation`
- `billing_event`
- `billing_adjustment`

Preserve existing:

- Regional pricing.
- Monthly and annual plans.
- Product and price identifiers.
- Checkout quote validation.
- Reservation lifecycle.
- Webhook pipeline.
- Reconciliation workers.
- Entitlement calculations.

## Webhooks

- Verify signatures using the Paddle notification signing secret.
- Use the raw request body.
- Never verify using the Paddle API key.
- Reject invalid signatures with a non-2xx response.
- Persist verified events durably.
- Handle duplicate deliveries idempotently.
- Handle out-of-order events.
- Support retry and recovery.
- Do not acknowledge an event as successfully processed before it is safely recorded.

Relevant events include:

- `customer.created`
- `customer.updated`
- `subscription.created`
- `subscription.updated`
- `subscription.canceled`
- `transaction.completed`

## Checkout

- Never trust client payment-success parameters.
- Verify the authenticated user.
- Correlate reservation, order and Paddle transaction.
- Verify amount, currency, price and plan.
- Never grant access based only on local client state.
- Never show payment confirmation without verified payment.
- Prevent duplicate payable transactions.
- Keep uncertain provider states protected.
- Allow safe recovery from abandoned checkout.

Closing checkout does not automatically prove that Paddle has cancelled the transaction.

Never release a linked reservation solely because it is old.

## Entitlements

Use the existing entitlement system.

- Active paid subscriptions grant access.
- Trial access follows actual product policy.
- Scheduled cancellation preserves access until the verified paid-through date.
- Expired subscriptions must not retain access.
- Past-due and paused states follow established business rules.
- Entitlement updates must be idempotent.

## Customer Portal

- Authenticate the user first.
- Resolve Paddle customer ID server-side.
- Never trust a customer ID from the browser.
- Create portal sessions using the existing Paddle SDK.
- Keep credentials server-side.
- Handle expired sessions and provider failures.

## Permanent Paddle Infrastructure

Never delete or offer to delete:

- Paddle notification destinations.
- Webhook signing secrets.
- Products.
- Prices.
- Customers.
- Subscriptions.
- Transactions.

These are persistent business infrastructure, not test cleanup.

# 7. Database Rules

- Follow existing Prisma conventions.
- Reuse existing models where possible.
- Do not introduce duplicate customer, subscription or entitlement tables without proven necessity.
- Respect foreign keys and unique constraints.
- Use transactions for related database mutations.
- Prevent race conditions.
- Make critical operations idempotent.
- Avoid orphaned records.
- Never delete billing history to hide an application bug.

Never run production migrations or destructive database operations without explicit authorization.

# 8. Recording and Export System

Preserve the existing recording architecture.

Verify:

- Camera and microphone permissions.
- Recording start, pause and stop.
- Recording persistence.
- Preview playback.
- Single active playback behaviour.
- Component cleanup.
- Export dimensions and aspect ratios.
- Platform-specific export settings.
- Download authorization.
- Plan restrictions.

Do not introduce autoplay or background playback regressions.

Ensure media resources and object URLs are properly cleaned up.

# 9. Cloudflare R2 and Storage

- Keep storage operations server-authorized.
- Validate file types and upload sizes.
- Generate signed URLs server-side.
- Apply appropriate expiration.
- Verify user ownership.
- Handle failed uploads and retries.
- Prevent unauthorized downloads.
- Never expose storage credentials.

# 10. Email and Notifications

Use the existing Resend integration.

- Keep email delivery server-side.
- Validate recipients.
- Handle provider failures.
- Prevent duplicate notifications where appropriate.
- Do not send real customer emails during automated tests.

# 11. Frontend and UX Standards

Every user-facing workflow must have:

- Clear loading state.
- Clear success state.
- Clear error state.
- Retry behaviour where appropriate.
- Responsive layouts.
- Consistent navigation.
- No misleading payment or activation messages.

Never display:

- Payment confirmed without verified payment.
- Subscription active without entitlement confirmation.
- Download successful before the file is available.
- Upload successful before storage confirms it.

Free users must be able to open Studio without unnecessary payment or activation popups.

# 12. Testing Requirements

Use the existing test framework and conventions.

Before declaring a task complete, run applicable:

1. Regression tests.
2. API tests.
3. Component tests.
4. Integration tests.
5. Full safe automated test suite.
6. TypeScript.
7. ESLint.
8. Production build.
9. `git diff --check`.

Use isolated test databases.

Never allow database-backed tests to write to production-looking database URLs.

Never weaken assertions or skip failing tests merely to obtain a green result.

Report exact passed, failed and skipped counts.

Playwright should be used for important end-to-end workflows when available.

# 13. Environment and Production Safety

Assume existing configured Vercel environment variables are present unless concrete evidence shows otherwise.

Never repeatedly request already configured credentials.

Never:

- Print secrets.
- Commit `.env` files.
- Change production environment variables without authorization.
- Enable Paddle Live without authorization.
- Run production database mutations without authorization.
- Perform real payments or cancellations without authorization.
- Deploy without explicit authorization.
- Commit or push without explicit authorization.

Paddle Live must remain disabled during development and testing unless explicitly approved.

# 14. Execution Workflow

For every implementation task:

1. Understand the requested outcome.
2. Inspect only the relevant existing code.
3. Identify the actual root cause.
4. Implement the complete fix.
5. Update dependent types and callers.
6. Add regression tests.
7. Run relevant verification.
8. Fix regressions caused by the implementation.
9. Inspect Git changes.
10. Report the outcome accurately.

Do not create unnecessary audit documents or duplicate reports.

Do not stop after identifying problems when implementation has been requested.

Do not rewrite working systems without a demonstrated reason.

# 15. Git and Repository Hygiene

- Preserve existing project structure.
- Remove only genuinely unused code.
- Do not remove working functionality to simplify tests.
- Do not commit generated files unnecessarily.
- Do not include credentials.
- Review deleted files and changed APIs.
- Keep changes focused.
- Do not commit or push unless explicitly requested.

# 16. Definition of Done

An implementation is complete only when:

- The requested functionality works.
- Existing workflows remain functional.
- Frontend and backend contracts agree.
- Database state is correct.
- External integrations are handled safely.
- Security and authorization are enforced.
- Regression tests pass.
- TypeScript, lint and build pass.
- Remaining limitations are clearly documented.
- Production verification is not falsely claimed.

# 17. Final Reporting Format

Keep completion reports concise.

**Implemented**

- Actual changes.
- Files affected.

**Verification**

- Tests passed/failed/skipped.
- TypeScript.
- Lint.
- Build.
- E2E results.

**Remaining issues**

- Only genuine unresolved blockers.

**Deployment**

- Local or deployed.
- Sandbox or Live verification.
- Any required authorization.

Never claim a task is complete when it has only been reviewed or partially implemented.

---

**Final principle: Build SupersmartX Studio as one reliable, integrated SaaS product. Preserve working functionality, fix root causes, verify every important workflow and prioritize execution over repeated discussions.**

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
