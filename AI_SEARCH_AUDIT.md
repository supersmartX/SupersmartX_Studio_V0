# AI Search Audit — SupersmartX Studio

## Executive Summary

SupersmartX Studio is a browser-based teleprompter and video recording SaaS at `studio.supersmartx.com` (canonical, redirects from `supersmartx.com`/`www`). Core value: speak naturally with teleprompter, record locally, export watermark-free. Current SEO/AI readiness is **PARTIALLY READY (42/100)** — brand and product are clear to humans but weak for crawlers/AI: no `robots.txt`, no `sitemap.xml`, landing is `use client` (critical content JS-only), no JSON-LD, metadata generic, no FAQ/HowTo, no evidence layer. P0 fixes are low-risk and high-impact.

## Project Understanding

```
Framework: Next.js 16.3.0 (App Router, Turbopack)
Language: TypeScript 5.7
UI: React 19, Tailwind CSS 4, Inter font
Rendering: Mixed — layout.tsx is Server (metadata), page.tsx is 'use client' (hero, pricing, How It Works), studio is 'use client'
Backend: Next.js API routes + @libsql/client (Turso), Auth: next-auth 5.0.0-beta.32 (Google, GitHub, Credentials, JWT 15m)
Hosting: Vercel, Domain: studio.supersmartx.com (canonical), www.supersmartx.com 308 → studio, R2: Cloudflare R2, Payments: Cashfree, Email: Resend
Public routes: /, /legal/privacy, /legal/terms, /auth/reset-password, /support/success (query), /api/auth/*, /api/health
Private routes: /studio (client guard via useSession, API auth via middleware), /api/exports/*, /api/export-jobs/*, /api/download, /api/user/*
Dynamic: /api/exports/[id], /api/exports/[id]/preview, /api/export-jobs/[id], /support/success?order_id=&plan=
Sitemap: MISSING
Robots: MISSING
Schema: NONE
Analytics: NONE (no GA, no Search Console verification meta)
Content system: Hardcoded in page.tsx + constants/index.ts (PRICING_PLANS, PLATFORM_PRESETS), legal pages static
```

**PROJECT TYPE**
```
Business: SupersmartX (supersmartx.com)
Product: SupersmartX Studio — Browser-based Teleprompter & Recording Studio
Category: SaaS / Creator Tool / Video Productivity / Teleprompter Software
Target audience: Creators, educators, founders, sales, teachers, podcasters, YouTubers, corporate presenters
Primary geography: Global (63-country PPP pricing), India-heavy traffic (ENG IN seen)
Primary user problem: Reading scripts while maintaining eye contact, recording professional video without installs
Primary solution: Web teleprompter + webcam recording + platform-specific export (1080p, crop/reframe) + local-first privacy
Main conversion: Free → Creator $7.99/mo (3 min → 30 min, 3/mo → unlimited, watermark → no watermark)
Primary competitors: Teleprompter.com, BIGVU, PromptSmart, VEED teleprompter, Riverside
Important entities: SupersmartX, SupersmartX Studio, Teleprompter, Video Recording, Export, Watermark, Cashfree
```

## Entity Model

```
Organization: SupersmartX
 ├── offers → Product: SupersmartX Studio (SoftwareApplication)
 ├── provides → Service: Teleprompter + Recording + Export
 ├── serves → Audience: Creators, Educators, Sales, Corporate, Podcasters
 ├── operates at → Location: supersmartx.com (no physical address — NAP_GAP)
 ├── integrates with → Platform: YouTube, Instagram, TikTok, LinkedIn (PLATFORM_PRESETS)
 ├── solves → Problem: Unnatural delivery, eye-contact loss, complex recording setup
 ├── used for → Use Case: YouTube video, sales pitch, online course, interview, presentation
 ├── priced as → Offer: Free ($0) / Creator ($7.99/mo) (REGION_PRICING 63)
 └── compared with → Competitor: MISSING_COMPARISON_PAGE
```

## Technical SEO Audit

| Check | Status | Evidence | Action |
|-------|--------|----------|--------|
| `robots.txt` | **FAIL** | No file in `app/` or `public/` | P0: Create |
| `sitemap.xml` | **FAIL** | No file | P0: Create |
| Canonical | **FAIL** | `layout.tsx:35` `metadataBase: https://www.supersmartx.com` but prod is `https://studio.supersmartx.com`; per-page canonical missing | P0: Fix base to `studio` + add per-page `alternates.canonical` |
| Indexability | Partial | Landing client-only, legal pages static; `/studio` should be `noindex` (private) but not set | P0: Add `noindex` to studio |
| HTTP status | Pass | 308 redirects for apex/www → studio via `next.config.ts` | OK |
| Orphan pages | Pass | All public pages linked from `/` or legal footer | OK |
| Rendering | **FAIL** | `src/app/page.tsx:1 'use client'` → hero H1, pricing, How It Works JS-only, not in initial HTML | P0: Move critical content to Server or add Server metadata + JSON-LD |
| Internal links | Weak | Only nav `Studio, How It Works, Pricing` + footer `Terms/Privacy` | P1: Add docs/FAQ links |

## Machine Readability Audit

- No JSON-LD, no `llms.txt`, hero video `poster` not set, pricing table is div-based not `<table>`, teleprompter content not crawlable (intended). **P0: Add JSON-LD**.

## Information Architecture Audit

| Question | URL | Has Answer? | Quality | Structured? |
|----------|-----|-------------|---------|-------------|
| What is this company? | / | Partial | Tagline only, no About | No |
| What is this product? | / | Yes | H1 “Record professional videos…” | No schema |
| Who is it for? | / | Weak | Generic lede, no personas | No |
| How does it work? | /#how-it-works | Yes | 3 steps | No HowTo schema |
| What does it cost? | /#pricing | Yes | Free/Creator 1080p | No Offer schema |
| What features? | / | Weak | Teleprompter, recording, export listed but not detailed | No |
| Use cases? | / | Missing | No use-case pages | No |
| Integrations? | / | Partial | Platform presets listed visually | No |
| Security/Privacy? | /legal/* | Yes | Privacy page exists | No |
| How to get started? | /studio | Yes | Start Free CTA | No |

## Content Audit

- **Direct-answer model missing:** H2 `Three steps to better videos` not phrased as question; no `What is SupersmartX Studio?` H2 with direct answer.
- **Pricing facts hidden:** 63-country pricing in code but not documented on page (only “Local pricing available”).
- **Evidence gap:** No testimonials, reviews, case studies, stats (EVIDENCE_GAP).

## Schema Audit

- Existing: **NONE**. Need `Organization`, `WebSite`, `SoftwareApplication`, `BreadcrumbList`, `FAQPage`, `HowTo`, `Offer`.

## Metadata Audit

- Global `layout.tsx:19` title `SupersmartX Studio` + description generic — **not unique per page**. Privacy/Terms have titles but no `openGraph`/`twitter`/`canonical`/`robots`. Studio should be `noindex`.

## Internal Linking Audit

- Landing → `#how-it-works`, `#pricing`, `/studio`, `/legal/*`. No links to docs, FAQ, comparison. No breadcrumb.

## Performance Audit

- Hero video `https://d8j0ntlcm91z4.cloudfront.net/...mp4` 1080p autoPlay, no `poster`, no lazy, `preload: auto`. Font `Inter` via `next/font` OK (self-hosted). No image optimization needed (no `next/image` hero). JS bundle includes `mp4-muxer` + `Cashfree SDK` lazy (good). **P2: Add poster, preload metadata, lazy video.**

## Accessibility Audit

- Heading hierarchy H1 → H2 correct, but landing H1 split in spans with `em` (OK). Landmarks `header/nav/main/section/footer` present, but `page.tsx` uses `div` for hero. Contrast `text-muted #52525B` 2.5:1 fail previously fixed to `text-secondary`. Focus states OK. Alt text missing on hero video (decorative). **P2: Add `aria-label` to video.**

## Trust / Authority Audit

- No `About`, no `Contact` page, no `sameAs` profiles, no `foundingDate`, no `address`. Email `support@supersmartx.com` only in legal. **Evidence gap**: no reviews, no G2/Product Hunt.

## AI Query Map (representative)

- Brand: What is SupersmartX Studio? What does SupersmartX do? Is SupersmartX Studio free?
- Product: What is browser teleprompter? How does teleprompter recording work?
- Problem: How to maintain eye contact while reading script? Best teleprompter for YouTube?
- Use Case: Teleprompter for teachers, sales, podcasters, corporate
- Pricing: How much does SupersmartX Studio cost? Free vs Creator?
- Comparison: SupersmartX vs BIGVU, Teleprompter.com alternatives
- Features: Does it support 1080p export? Watermark?
- How-To: How to record with teleprompter in browser?

## Content Gaps

- Missing: `/features`, `/use-cases`, `/faq`, `/about`, `/contact`, `/compare/*`, `/alternatives`
- Priority P1: FAQ page (genuine questions from pricing: watermark, 3/mo, 30 min), HowTo schema

## Evidence Gaps

- No stats, benchmarks, case studies. All claims qualitative.

## Off-Page Gaps

- No `sameAs` LinkedIn/GitHub/Product Hunt/Crunchbase. Create checklist, no fake accounts.

## Prioritized Fix List

**P0 Critical** — blocks indexing/AI understanding
- robots.txt + sitemap.xml
- Fix metadataBase to `https://studio.supersmartx.com` + per-page canonical
- Studio `noindex`
- JSON-LD Organization + SoftwareApplication + WebSite
- Move critical pricing/How It Works facts to be crawlable (server metadata already, add JSON-LD)

**P1 High**
- Open Graph/Twitter per page
- BreadcrumbList
- FAQPage + HowTo schemas
- FAQ page

**P2 Medium**
- Video poster, performance, comparison content
- P3 growth
