# SupersmartX Studio

Record Once, Publish Anywhere — a browser-based video studio with platform-agnostic recording, post-recording platform selection, crop/reframe export in MP4 H.264/AAC, server-side entitlements, and cloud storage.

## Features

### Core Recording
- **Platform-Agnostic Master Recording** — Capture raw camera at any resolution/aspect ratio, then choose export platform after recording
- **Teleprompter** — Smooth scrolling script display with adjustable speed, font, alignment, and text position
- **Camera Integration** — 7-level fallback constraints, device enumeration, auto-select on connect/disconnect
- **Recording Controls** — Start, pause, resume, stop with 3-2-1 countdown overlay
- **AudioWorkletNode** — Stereo 2ch recording via AudioWorklet (replaced deprecated ScriptProcessorNode)
- **Focus View** — Camera preview at eye-line for natural eye contact

### Export Pipeline
- **8 Platform Presets** — YouTube, YouTube Shorts, Instagram Reels, Instagram Post, Instagram Portrait, TikTok, LinkedIn, Custom
- **Client-Side WebCodecs Encoding** — H.264 (10 Mbps CBR) + AAC-LC (192 kbps) via mp4-muxer
- **Crop & Reframe** — Per-platform crop with zoom, automatic center-crop defaults
- **Batch Export** — Export to multiple platforms sequentially (Pro plan)
- **Server-Side Job Tracking** — Full lifecycle: pending → encoding → uploading → completed | failed

### Cloud Storage & Security
- **Cloudflare R2** — Private storage with signed URL downloads (configurable TTL)
- **Export Ownership** — Database-backed ownership verification, no public URLs
- **Atomic Download Counts** — Race-condition-safe download limit enforcement
- **Server-Side Entitlements** — Plan enforcement on upload and download endpoints

### Auth & Payments
- **NextAuth v5** — JWT strategy, register/login, forgot/reset password
- **Cashfree Payments** — Regional pricing for 55+ countries, webhook verification
- **5 Plans** — Free (3 downloads, 5min limit), Creator (unlimited, 1080p), Pro (4K, batch export)

### Studio UI
- **Responsive Layout** — Desktop (IconRail + Canvas + InspectorPanel) and Mobile (BottomNav)
- **InspectorPanel** — Teleprompter settings, device selection, platform config, mirror toggle
- **Keyboard Shortcuts** — Space (record), Arrows (nudge script), Esc (close)
- **Welcome Modal** — First-visit introduction
- **Toast Notifications** — Auto-dismiss feedback

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16.3.0 (Turbopack) |
| Language | TypeScript 5.7, React 19 |
| Styling | Tailwind CSS 4 |
| Auth | NextAuth v5 beta.32 (JWT strategy) |
| Database | @libsql/client (SQLite via Turso) |
| Cloud Storage | Cloudflare R2 (S3-compatible) |
| Video Export | WebCodecs API + mp4-muxer 5.2.2 |
| Email | Resend |
| Payments | Cashfree |
| Unit Tests | Vitest 2.0.5 + Testing Library |
| E2E Tests | Playwright 1.62.1 |

## Getting Started

### Prerequisites

- Node.js 20+
- npm/yarn/pnpm

### Installation

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your credentials

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Environment Variables

```env
# Auth
NEXTAUTH_SECRET=
NEXTAUTH_URL=

# Database (local SQLite or Turso)
TURSO_DATABASE_URL=file:data/supersmartx.db
# TURSO_DATABASE_URL=libsql://your-db.turso.io
# TURSO_AUTH_TOKEN=

# Cloudflare R2 (optional — enables cloud export)
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_SIGNED_URL_TTL_SECONDS=3600

# Cashfree
CASHFREE_APP_ID=
CASHFREE_SECRET_KEY=
CASHFREE_ENV=SANDBOX

# Resend (email)
RESEND_API_KEY=

# Cleanup (optional — for export job cleanup cron)
CLEANUP_SECRET=
```

## Database Schema (v4)

| Table | Purpose |
|-------|---------|
| `users` | User accounts with plan and expiry |
| `reset_tokens` | Password reset tokens |
| `user_stats` | Download/upload counts, storage bytes |
| `exports` | Export records with R2 keys and ownership |
| `export_jobs` | Export job lifecycle (pending → encoding → uploading → completed | failed) |
| `schema_meta` | Schema version tracking |

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── auth/               # NextAuth routes
│   │   ├── cashfree/           # Payment order + webhook
│   │   ├── download/           # Signed URL download
│   │   ├── export-jobs/        # Job lifecycle (create, update, status, cleanup)
│   │   ├── export-upload/      # R2 upload with ownership record
│   │   ├── recordings/         # Recording management
│   │   ├── upload/             # Master recording upload
│   │   └── user/stats/         # User statistics
│   ├── studio/                 # Main studio page
│   ├── auth/                   # Password reset page
│   ├── legal/                  # Privacy and terms
│   └── support/                # Payment success page
├── components/
│   ├── auth/                   # AuthModal
│   ├── common/                 # Toast
│   ├── dialogs/                # ExportModal, PricingModal, WelcomeModal
│   ├── editor/                 # InspirationLoader
│   ├── icons/                  # SVG icon library
│   ├── layout/                 # Header, IconRail, BottomNav, InspectorPanel, Canvas, TransportBar, DeviceSelectorBar, Footer
│   ├── studio/                 # CameraPreview, TeleprompterOverlay, Timer, RecordingBadge, CountdownOverlay, InitOverlay, FocalGuideway, LibraryPanel
│   └── ui/                     # Button, Modal, Slider, Select, Toggle, Tabs, Tooltip, Badge, Card, IconButton, Progress
├── hooks/
│   ├── useCamera.ts            # MediaStream + device enumeration
│   ├── useRecorder.ts          # MediaRecorder state machine
│   ├── useMasterRecording.ts   # Blob lifecycle + IndexedDB
│   ├── useExportPipeline.ts    # WebCodecs encoding + R2 upload + job tracking
│   ├── useSettings.ts          # localStorage settings store
│   ├── useRecordingConfig.ts   # Recording resolution/platform config
│   ├── useStudioConfig.ts      # Settings + recording config sync
│   ├── useStudioCamera.ts      # Camera init, device selection, platform reinit
│   ├── useRecordingTimer.ts    # Timer + free-plan limit
│   ├── useStudioUI.ts          # Drawer, auth, pricing modal state
│   └── ...                     # useToast, useShare, useFocusView, useKeyboardShortcuts, useScriptStorage, useWelcomeModal
├── lib/
│   ├── db/                     # Database driver, schema, migrations, CRUD
│   ├── r2.ts                   # Cloudflare R2 client
│   ├── entitlements.ts         # Plan-to-features mapping
│   ├── auth-guard.ts           # Pending download pattern
│   ├── cashfree.ts             # Payment client
│   ├── email.ts                # Resend email
│   ├── pricing.ts              # Regional pricing
│   ├── preview.ts              # Guest preview limits
│   ├── recording-store.ts      # IndexedDB wrapper
│   └── user-store.ts           # User DB operations
├── types/
│   ├── index.ts                # App types (ExportJob, ExportConfig, MasterRecording, etc.)
│   └── db.ts                   # DB types (PlanType, StoredUser, ExportJobRecord, etc.)
├── constants/                  # Platform presets, pricing plans, fonts, scripts
├── services/                   # Download service
├── tokens/                     # Design tokens
└── auth.ts                     # NextAuth config
```

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/auth/*` | * | NextAuth authentication |
| `/api/auth/forgot-password` | POST | Send reset email |
| `/api/auth/reset-password` | POST | Reset password with token |
| `/api/export-jobs` | POST | Create export job |
| `/api/export-jobs/[id]` | PATCH | Update job status |
| `/api/export-jobs/[id]/status` | GET | Poll job status |
| `/api/export-jobs/cleanup` | POST | Delete old jobs (cron) |
| `/api/export-upload` | POST | Upload encoded MP4 to R2 |
| `/api/download` | GET | Get signed download URL |
| `/api/upload` | POST | Upload master recording |
| `/api/recordings` | GET | List user recordings |
| `/api/user/stats` | GET | User statistics |
| `/api/cashfree/order` | POST | Create payment order |
| `/api/cashfree/webhook` | POST | Payment webhook |

## Scripts

```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run start        # Start production server
npm run lint         # Run ESLint
npm run test         # Run Vitest
npm run test:watch   # Run Vitest in watch mode
npm run test:e2e     # Run Playwright E2E tests
```

## Export Flow

```
1. POST /api/export-jobs          → Create job (status: pending)
2. PATCH /api/export-jobs/[id]     → Mark as encoding
3. Client-side WebCodecs encoding  → H.264 + AAC → MP4 blob
4. POST /api/export-upload         → Upload to R2 + create export record
5. Job auto-marked completed       → Ready for download
6. GET /api/download?exportId=...  → Signed URL → Browser download
```

## Deployment

Deployed on Vercel at [https://www.supersmartx.com/](https://www.supersmartx.com/)

1. Push to GitHub
2. Import in Vercel
3. Add environment variables
4. Deploy

### Production Requirements

- HTTPS required (WebRTC/camera APIs fail on HTTP)
- `Permissions-Policy: camera=(self), microphone=(self)` header
- HSTS enabled with `max-age=63072000; includeSubDomains; preload`

## Verification

| Check | Status |
|-------|--------|
| TypeScript | 0 errors |
| Lint | 0 errors |
| Unit Tests | 136/136 pass |
| Build | Successful |

## License

Private — SupersmartX Organization
