# SupersmartX Studio

Interactive Teleprompter and Video Script Reader built with Next.js 16, React 19, and Tailwind CSS.

## Features

- **Teleprompter** — Smooth scrolling script display with adjustable speed, font, and alignment
- **Camera Integration** — Record videos while reading scripts with real-time preview
- **Recording Controls** — Start, pause, resume, stop with countdown timer
- **Device Selection** — Switch cameras and microphones on the fly
- **Focus View** — Camera preview at eye-line for natural eye contact
- **Export & Download** — Save recordings as WebM/MP4 with playback preview
- **Share** — Web Share API with clipboard fallback
- **Authentication** — NextAuth v5 with multiple providers (sign-in required only for downloads)
- **Payment Integration** — Cashfree payment gateway for support
- **Discord Feedback** — Community feedback integration
- **Landing Page** — Marketing page at `/` with features, how-it-works, and privacy info

## Tech Stack

- **Framework:** Next.js 16 (App Router, Turbopack)
- **UI:** React 19, Tailwind CSS 4
- **Auth:** NextAuth v5 (Beta)
- **Payments:** Cashfree JS SDK
- **Language:** TypeScript

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

# Cashfree
CASHFREE_APP_ID=
CASHFREE_SECRET_KEY=
CASHFREE_ENV=SANDBOX

# Discord (optional)
DISCORD_WEBHOOK_URL=
```

## Project Structure

```
src/
├── app/                         # Next.js App Router pages
│   ├── api/                    # API routes
│   │   ├── auth/               # NextAuth catch-all route
│   │   └── cashfree/           # Cashfree order + webhook routes
│   ├── studio/                 # Teleprompter studio (main app)
│   └── support/                # Support success page
├── components/
│   ├── auth/                   # AuthModal, AuthProvider
│   ├── common/                 # Toast notifications
│   ├── dialogs/                # ExportModal, SupportModal, WelcomeModal, DiscordFeedback
│   ├── editor/                 # InspirationLoader (script templates)
│   ├── icons/                  # Icon library (SVG components)
│   ├── layout/                 # Header, Footer, IconRail, BottomNav, Canvas, TransportBar, InspectorPanel, DeviceSelectorBar
│   ├── studio/                 # CameraPreview, TeleprompterOverlay, Timer, RecordingBadge, CountdownOverlay, InitOverlay, FocalGuideway
│   └── ui/                     # Button, Modal, Slider, Select, Toggle, Tabs, Tooltip, Badge, Card, IconButton, Progress
├── features/
│   ├── library/                # Library placeholder (coming soon)
│   └── insights/               # Insights placeholder (coming soon)
├── hooks/                      # useCamera, useRecorder, useToast, useShare, useFocusView, useKeyboardShortcuts, useScriptStorage, useWelcomeModal
├── lib/                        # auth-guard (pending download)
├── services/                   # discord.service, download.service
├── types/                      # TypeScript type definitions
├── constants/                  # App constants (settings, fonts, inspiration scripts)
└── auth.ts                     # NextAuth configuration
```

## Routes

| Path | Description |
|------|-------------|
| `/` | Landing page with features, how-it-works, privacy info |
| `/studio` | Main teleprompter studio |
| `/support/success` | Payment success redirect |
| `/api/auth/*` | NextAuth API routes |
| `/api/cashfree/*` | Cashfree payment API routes |

## Scripts

```bash
npm run dev      # Start dev server
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Run ESLint
```

## Deployment

Deployed on Vercel at [https://studio.supersmartx.com/](https://studio.supersmartx.com/)

1. Push to GitHub
2. Import in Vercel
3. Add environment variables (including `NEXTAUTH_SECRET`)
4. Deploy

### Production Requirements

- HTTPS required (WebRTC/camera APIs fail on HTTP)
- `Permissions-Policy: camera=(self), microphone=(self)` header
- HSTS enabled with `max-age=63072000; includeSubDomains; preload`
- `overflow-x: hidden` on html/body to prevent mobile horizontal scroll

## License

Private - SupersmartX Organization
