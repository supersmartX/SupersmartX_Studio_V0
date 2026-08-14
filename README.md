# SupersmartX Studio

Interactive Teleprompter and Video Script Reader built with Next.js 16, React 19, and Tailwind CSS.

## Features

- **Teleprompter** — Smooth scrolling script display with adjustable speed
- **Camera Integration** — Record videos while reading scripts
- **Authentication** — NextAuth v5 with multiple providers
- **Payment Integration** — Cashfree payment gateway
- **Real-time Collaboration** — Discord integration for feedback

## Tech Stack

- **Framework:** Next.js 16 (App Router)
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
├── app/                    # Next.js App Router pages
│   ├── api/               # API routes
│   ├── studio/            # Teleprompter studio
│   └── support/           # Support pages
├── components/
│   ├── auth/              # Authentication components
│   ├── layout/            # Layout components (Header, Footer, etc.)
│   ├── studio/            # Studio-specific components
│   └── ui/                # Reusable UI components
├── hooks/                 # Custom React hooks
├── lib/                   # Utilities and guards
├── services/              # External service integrations
├── types/                 # TypeScript types
��── constants/             # App constants
```

## Scripts

```bash
npm run dev      # Start dev server
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Run ESLint
```

## Deployment

Deploy on Vercel:

1. Push to GitHub
2. Import in Vercel
3. Add environment variables
4. Deploy

## License

Private - SupersmartX Organization