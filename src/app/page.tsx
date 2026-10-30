'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { AuthModal } from '@/components/auth/AuthModal';
import {
  getPricingForCountry,
  formatPrice,
  formatPriceZero,
  formatSavingsPercent,
} from '@/lib/pricing';
import { PRICING_PLANS } from '@/constants';
import { JsonLd } from '@/components/seo/JsonLd';
import { SEO_CONFIG } from '@/lib/seo/config';
import '@/styles/pricing.css';

const NAV_LINKS = [
  { label: 'Studio', href: '#top' },
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'Pricing', href: '#pricing' },
];

// The operational waste the page argues against. Kept as data so the section
// and the copy stay in one place.
const WASTE_ITEMS = [
  'Re-recording',
  'Eye-drift errors',
  'Awkward pauses',
  'Manual timeline editing',
  'Platform-specific reformatting',
  'Re-cropping footage',
  'Unnecessary desktop editing workflows',
];

const METRICS = [
  { value: '1 Take', label: 'Target recording cycle' },
  { value: 'Zero', label: 'Timeline editing needed' },
  { value: '3 Formats', label: 'Native 9:16, 16:9, 1:1 outputs' },
];

const FLOW_STEPS = [
  {
    stage: 'Script',
    title: 'Voice-Sync Cadence Prompter',
    description:
      'Paste your script. The prompt dynamically tracks your natural speaking velocity, eliminating eye-dart and awkward pauses without requiring manual speed adjustment.',
  },
  {
    stage: 'Record',
    title: 'Real-Time Precision Capture Engine',
    description:
      'Capture direct 1080p video straight through your browser pipeline with zero latency, background noise filtering, and no desktop apps choking device memory.',
  },
  {
    stage: 'Publish',
    title: 'Multi-Platform Instant Export Pipeline',
    description:
      'Render native, perfectly framed aspect ratios for YouTube, Reels, and Shorts simultaneously without touching timeline software or re-cropping footage.',
  },
];

const FREE_FEATURES = [
  '3-minute teleprompter sessions',
  'Up to 10 minutes recording / day',
  'Standard 720p output preview',
];

// First item is the economic anchor of the tier and is rendered highlighted.
const CREATOR_FEATURES = [
  'Saves 15+ hours/month in recording retakes',
  'Voice-activated dynamic teleprompter engine',
  'Unlimited recording duration & cloud library',
  'Unbranded crystal-clear 1080p multi-format exports',
];

// Drives both the visible FAQ and the FAQPage structured data, so the two can
// never drift apart.
const FAQ_ITEMS = [
  {
    q: 'Will it work with my camera and microphone?',
    a: 'Yes. SupersmartX Studio uses the webcam and microphone your computer already has - built-in or USB. There is no extra hardware to buy and nothing to install.',
  },
  {
    q: 'Can my browser really capture 1080p video?',
    a: 'Yes. Capture runs directly through the browser pipeline at native 1080p with zero latency, so no desktop app is competing for your device memory while you record.',
  },
  {
    q: 'How fast can I go from script to recording?',
    a: 'Paste your script, press record, and the prompter follows your natural speaking pace. There is nothing to set up first - ready in 30 seconds, no downloads or installs required.',
  },
  {
    q: 'Do I need editing software or editing skills?',
    a: 'No. There is no timeline to edit. Creator Pro renders native, perfectly framed 9:16, 16:9 and 1:1 ratios without re-cropping footage or touching timeline software.',
  },
  {
    q: 'What do I need to get started?',
    a: 'A browser, a camera and a microphone. Ready in 30 seconds · No downloads or installs required.',
  },
  {
    q: 'How much does SupersmartX Studio cost?',
    a: 'Free forever with a standard teleprompter (3 minutes per recording), YouTube 16:9, 720p, unlimited local downloads and watermark. Free recording is limited to up to 10 minutes per browser profile per local calendar day. This is a device-local limit and may reset if site data is cleared or you switch browser profiles. Creator access is a one-time payment for 1 month or 1 year; access expires at the end of the purchased term with no automatic renewal.',
  },
  {
    q: 'Is there a watermark on the free plan?',
    a: 'Yes, free exports include a SupersmartX watermark. Creator exports have none.',
  },
];

function GrainOverlay() {
  return (
    <div
      className="lsx-grain"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 5,
        pointerEvents: 'none',
        opacity: 0.035,
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'repeat',
      }}
    />
  );
}

// Confined to the hero: below the fold the page is a solid canvas so the copy
// sections sit on a stable contrast surface.
function HeroVideo() {
  return (
    <div className="lsx-hero-photo" aria-hidden="true">
      <video autoPlay muted loop playsInline preload="auto">
        <source
          src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260818_072341_50851634-bbc3-4c33-9acc-7647d4db44aa.mp4"
          type="video/mp4"
        />
      </video>
      <div className="lsx-hero-scrim" />
    </div>
  );
}

function FlowStepIcon({ index }: { index: number }) {
  if (index === 0) {
    return (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
        <path d="m15 5 4 4" />
      </svg>
    );
  }
  if (index === 1) {
    return (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
        <circle cx="12" cy="13" r="3" />
      </svg>
    );
  }
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 12h8" />
      <path d="M4 18V6" />
      <path d="M12 18V6" />
      <path d="m17 12 3-2v8l-3-2" />
    </svg>
  );
}

export default function LandingPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  // UX-005: 'login' opens the sign-in step (Log in buttons), 'register'
  // (default) opens the account chooser (checkout / creator flows).
  const [authIntent, setAuthIntent] = useState<'register' | 'login'>(
    'register',
  );
  // True once a "Get Creator" CTA has stored sxs-pending-plan this session.
  // Distinguishes an intentional upgrade (checkout param allowed on the
  // post-auth redirect) from ordinary sign-in, which must land on plain
  // /studio - an unconditional ?checkout= reopens payment after every login.
  const [hasPendingPlan, setHasPendingPlan] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>(
    'monthly',
  );
  const user = session?.user;
  const userMenuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        userMenuRef.current &&
        !userMenuRef.current.contains(e.target as Node)
      ) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Creator CTA: remember plan, then login → studio opens payment form directly
  const handleCreatorClick = useCallback(() => {
    const plan = `creator_${billingPeriod}`;
    try {
      window.localStorage.setItem('sxs-pending-plan', plan);
      setHasPendingPlan(true);
    } catch {}
    if (session?.user) {
      router.push(`/studio?checkout=${plan}`);
    } else {
      setAuthIntent('register');
      setIsAuthModalOpen(true);
    }
  }, [billingPeriod, session?.user, router]);

  // OAuth redirects bypass onSuccess, so the callback URL itself must carry
  // the checkout intent - but only when a purchase was actually initiated.
  // Ordinary Google sign-in returning with ?checkout= reopened the payment
  // form after every login (Issue 2).
  const creatorCallbackUrl = hasPendingPlan
    ? `/studio?checkout=creator_${billingPeriod}`
    : '/studio';

  const handleLandingAuthSuccess = useCallback(() => {
    try {
      const stored = window.localStorage.getItem('sxs-pending-plan');
      const plan =
        stored === 'creator_monthly' || stored === 'creator_yearly'
          ? stored
          : null;
      router.push(plan ? `/studio?checkout=${plan}` : '/studio');
    } catch {
      router.push('/studio');
    }
  }, [router]);

  const currentPricing = getPricingForCountry('US');
  const format = (amount: number) =>
    formatPrice(amount, currentPricing.symbol, currentPricing.locale);
  const formatZero = (amount: number) =>
    formatPriceZero(amount, currentPricing.symbol, currentPricing.locale);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  // Dismissal that returns the keyboard to the control that opened the menu.
  // Actions inside the menu (a section link, Log in, Launch Studio) deliberately
  // do NOT use this: focus must follow the action, not snap back to the burger.
  const dismissMenu = useCallback(() => {
    setMenuOpen(false);
    const button = menuButtonRef.current;
    // The burger is not rendered at ≥901px, where the menu force-closes on
    // resize - a focus() there would silently drop focus to <body>.
    if (button && button.offsetParent !== null)
      button.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    document.documentElement.style.height = menuOpen ? 'auto' : '';
    document.documentElement.style.overflow = menuOpen ? 'hidden' : '';
    document.body.style.height = menuOpen ? 'auto' : '';
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => {
      document.documentElement.style.height = '';
      document.documentElement.style.overflow = '';
      document.body.style.height = '';
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 901px)');
    const handler = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches) closeMenu();
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [closeMenu]);

  useEffect(() => {
    if (!menuOpen) return;
    const menu = menuRef.current;
    // Modal focus contract, matching ExportModal: move focus into the dialog
    // on open, keep Tab cycling inside it, and Escape closes + restores.
    const initial =
      menu?.querySelector<HTMLElement>('.lsx-mobile-nav-link') ??
      menu?.querySelector<HTMLElement>('button, a[href]');
    initial?.focus({ preventScroll: true });

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        dismissMenu();
        return;
      }
      if (e.key !== 'Tab' || !menu) return;
      const focusables = Array.from(
        menu.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      if (!activeEl || !menu.contains(activeEl)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && activeEl === first) {
        e.preventDefault();
        last.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [menuOpen, dismissMenu]);

  useEffect(() => {
    const cleanupFns: Array<() => void> = [];
    const raf = requestAnimationFrame(() => {
      const appears = document.querySelectorAll<HTMLElement>('.lsx-appear');
      const heroPhoto = document.querySelector('.lsx-hero-photo');

      appears.forEach((el) => {
        const anims = el.getAnimations();
        if (anims.length === 0) {
          el.classList.add('lsx-is-in');
        } else {
          const handler = () => el.classList.add('lsx-is-in');
          el.addEventListener('animationend', handler, { once: true });
          cleanupFns.push(() =>
            el.removeEventListener('animationend', handler),
          );
        }
      });

      if (heroPhoto) {
        const anims = heroPhoto.getAnimations();
        if (anims.length === 0) {
          heroPhoto.classList.add('lsx-is-in');
        } else {
          const handler = () => heroPhoto.classList.add('lsx-is-in');
          heroPhoto.addEventListener('animationend', handler, { once: true });
          cleanupFns.push(() =>
            heroPhoto.removeEventListener('animationend', handler),
          );
        }
      }

      const timerId = setTimeout(() => {
        appears.forEach((el) => {
          if (!el.classList.contains('lsx-is-in'))
            el.classList.add('lsx-is-in');
        });
        if (heroPhoto && !heroPhoto.classList.contains('lsx-is-in')) {
          heroPhoto.classList.add('lsx-is-in');
        }
      }, 2500);
      cleanupFns.push(() => clearTimeout(timerId));
    });
    cleanupFns.push(() => cancelAnimationFrame(raf));
    return () => cleanupFns.forEach((fn) => fn());
  }, []);

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
@import url('https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=Instrument+Serif:ital@1&display=swap');

.lsx-hero-photo { position: absolute; inset: 0; z-index: 0; opacity: 0; transition: opacity 1.05s cubic-bezier(0.16, 1, 0.3, 1); }
.lsx-hero-photo video { width: 100%; height: 100%; object-fit: cover; }
.lsx-hero-photo.lsx-is-in { opacity: 1; }
.lsx-hero-scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(9,9,11,0.58) 0%, rgba(9,9,11,0.4) 42%, rgba(9,9,11,0.92) 100%);
}

.lsx-page {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-rows: auto 1fr auto;
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--color-canvas);
}

.lsx-header {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  padding: var(--lsx-header-y, 22px) var(--lsx-header-x, 40px) 10px;
  z-index: 50;
  position: relative;
}

.lsx-logo {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  justify-self: start;
  font-size: var(--lsx-logo, 15.5px);
  font-weight: 600;
  letter-spacing: -0.03em;
  color: #fff;
  /* UX-007: 24px-tall logo link gets a ≥40px hit box without layout shift. */
  position: relative;
}
.lsx-logo::after {
  content: '';
  position: absolute;
  inset: -10px -8px;
}
.lsx-logo-suffix { font-weight: 400; }

.lsx-site-nav {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-self: center;
}
.lsx-nav-mobile-cta { display: none; }

.lsx-nav-pill {
  height: var(--lsx-nav-h, 40px);
  padding: 0 18px;
  border-radius: 7px;
  overflow: hidden;
  position: relative;
  border: 1px solid rgba(255,255,255,0.1);
  background: var(--color-surface);
  color: #fff;
  font-size: var(--lsx-nav, 14px);
  font-weight: 400;
  letter-spacing: -0.01em;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}
.lsx-nav-pill:hover {
  background: rgba(255,255,255,0.05);
}
.lsx-nav-pill:focus-visible {
  outline: 2px solid var(--color-accent-hover);
  outline-offset: 2px;
}

.lsx-header-cta-wrap { justify-self: end; }

.lsx-btn {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: var(--lsx-btn-h, 40px);
  padding: 0 16px;
  border-radius: 6px;
  font-size: var(--lsx-btn, 13.5px);
  font-weight: 500;
  letter-spacing: -0.02em;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, color 0.2s ease;
}

.lsx-btn-solid {
  background: linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-dark) 100%);
  color: #fff;
  border: 1px solid var(--color-accent);
}
.lsx-btn-solid:hover {
  background: linear-gradient(135deg, var(--color-accent-hover) 0%, var(--color-accent) 100%);
  border-color: var(--color-accent-hover);
}
.lsx-btn-solid:focus-visible {
  outline: 2px solid var(--color-accent-hover);
  outline-offset: 2px;
}

.lsx-btn-ghost {
  background: var(--color-surface);
  color: #fff;
  border: 1px solid rgba(255,255,255,0.1);
}
.lsx-btn-ghost:hover {
  background: rgba(255,255,255,0.05);
}
.lsx-btn-ghost:focus-visible {
  outline: 2px solid var(--color-accent-hover);
  outline-offset: 2px;
}

.lsx-hero-btn {
  height: var(--lsx-hero-btn-h, 42px);
  padding: 0 18px;
}
/* The primary CTA label is a full sentence: allow it to wrap rather than clip
   on narrow phones instead of inheriting .lsx-btn's nowrap. */
.lsx-hero-cta {
  height: auto;
  min-height: var(--lsx-hero-btn-h, 42px);
  padding: 12px 22px;
  line-height: 1.25;
  white-space: normal;
  text-align: center;
}
.lsx-hero-ghost {
  background: var(--color-surface);
  border: 1px solid rgba(255,255,255,0.1);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}
.lsx-hero-ghost:hover {
  background: rgba(255,255,255,0.05);
}

.lsx-hero {
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 72px 24px var(--lsx-hero-gap, 88px);
  min-height: 0;
}

.lsx-hero-copy {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  max-width: var(--lsx-copy-max, 900px);
  width: 100%;
}

.lsx-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 22px;
  padding: 9px 15px;
  border: 1px solid rgba(124,58,237,0.25);
  border-radius: 5px;
  background: rgba(124,58,237,0.08);
  color: #fff;
  font-size: var(--lsx-badge, 12.5px);
  font-weight: 400;
  letter-spacing: -0.01em;
}
.lsx-badge-star {
  filter: drop-shadow(0 0 3px rgba(255,255,255,0.45));
}

.lsx-hero h1 {
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: var(--lsx-h1, 48px);
  font-weight: 500;
  letter-spacing: -0.045em;
  line-height: 1.12;
  color: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
}

.lsx-headline-line {
  display: block;
  overflow: hidden;
  padding: 0.06em 0.15em 0.14em;
}

.lsx-headline-line em {
  font-family: 'Instrument Serif', 'Times New Roman', Times, serif;
  font-style: italic;
  font-weight: 400;
  font-size: 1.08em;
  letter-spacing: -0.03em;
  color: var(--color-accent);
}

.lsx-lede {
  max-width: var(--lsx-lede-max, 620px);
  margin-top: 18px;
  color: var(--color-text-secondary);
  font-size: var(--lsx-lede, 15.5px);
  font-weight: 400;
  line-height: 1.55;
  letter-spacing: -0.015em;
}

.lsx-hero-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  margin-top: 28px;
}

.lsx-cta-support {
  margin-top: 16px;
  font-size: var(--lsx-support, 12.5px);
  letter-spacing: -0.005em;
  color: rgba(255,255,255,0.55);
}

.lsx-burger {
  display: none;
  width: 42px;
  height: 42px;
  border-radius: 6px;
  border: 1px solid rgba(255,255,255,0.1);
  background: var(--color-surface);
  z-index: 60;
  cursor: pointer;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0;
}
.lsx-burger-bar {
  display: block;
  width: 16px;
  height: 1.5px;
  background: #fff;
  border-radius: 1px;
  transition: transform 0.25s ease, opacity 0.2s ease;
}
.lsx-burger.is-open .lsx-burger-bar:nth-child(1) { transform: translateY(6.5px) rotate(45deg); }
.lsx-burger.is-open .lsx-burger-bar:nth-child(2) { opacity: 0; }
.lsx-burger.is-open .lsx-burger-bar:nth-child(3) { transform: translateY(-6.5px) rotate(-45deg); }
.lsx-burger:hover {
  border-color: rgba(255,255,255,0.32);
  background: rgba(255,255,255,0.05);
}

.lsx-appear { opacity: 1; animation-duration: 1.05s; animation-fill-mode: both; animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1); animation-delay: var(--lsx-d, 0.08s); }
.lsx-appear.lsx-is-in { animation: none; opacity: 1; transform: none; clip-path: none; filter: none; }

.lsx-appear--scale { animation-name: lsx-in-scale; }
.lsx-appear--soft { animation-name: lsx-in-soft; }
.lsx-appear--mask { animation-name: lsx-in-mask; }
.lsx-appear--pop { animation-name: lsx-in-pop; }
.lsx-appear--btn { animation-name: lsx-in-btn; }
.lsx-appear--side { animation-name: lsx-in-side; }
.lsx-appear--stat { animation-name: lsx-in-stat; }

.lsx-badge-star { animation: lsx-in-star 0.9s 0.28s both cubic-bezier(0.16, 1, 0.3, 1); }
.lsx-badge-star.lsx-is-in { animation: none; }
.lsx-hero h1 em { animation: lsx-in-em 1.2s 0.72s both cubic-bezier(0.16, 1, 0.3, 1); }
.lsx-hero h1 em.lsx-is-in { animation: none; opacity: 1; filter: none; }

@keyframes lsx-in-scale { from { opacity: 0; transform: scale(0.84); } }
@keyframes lsx-in-soft { from { opacity: 0; transform: translateY(14px); } }
@keyframes lsx-in-mask { from { opacity: 0; transform: translateY(40%); } }
@keyframes lsx-in-pop { 0% { opacity: 0; transform: scale(0.9); } 70% { transform: scale(1.03); } 100% { opacity: 1; transform: scale(1); } }
@keyframes lsx-in-btn { from { opacity: 0; transform: translateY(18px) scale(0.94); } }
@keyframes lsx-in-side { from { opacity: 0; transform: translateX(22px); } }
@keyframes lsx-in-stat { from { opacity: 0; transform: translateY(20px); } }
@keyframes lsx-in-star { 0% { opacity: 0; transform: scale(0.2) rotate(-50deg); } 65% { opacity: 1; transform: scale(1.2) rotate(8deg); } 100% { opacity: 1; transform: scale(1) rotate(0deg); } }
@keyframes lsx-in-em { from { opacity: 0.35; filter: blur(4px); } }

@media (prefers-reduced-motion: reduce) {
  .lsx-appear, .lsx-hero-photo, .lsx-hero h1 em, .lsx-badge-star { opacity: 1 !important; transform: none !important; clip-path: none !important; filter: none !important; animation: none !important; }
}

@media (min-width: 1600px) {
  .lsx-page { --lsx-logo: 17px; --lsx-nav: 15px; --lsx-nav-h: 44px; --lsx-btn: 15px; --lsx-btn-h: 44px; --lsx-hero-btn-h: 48px; --lsx-h1: 64px; --lsx-lede: 18px; --lsx-badge: 13.5px; --lsx-support: 14px; --lsx-header-y: 28px; --lsx-header-x: 64px; --lsx-copy-max: 980px; --lsx-lede-max: 680px; }
}
@media (min-width: 1920px) {
  .lsx-page { --lsx-logo: 18px; --lsx-nav: 16px; --lsx-nav-h: 48px; --lsx-btn: 16px; --lsx-btn-h: 48px; --lsx-hero-btn-h: 52px; --lsx-h1: 76px; --lsx-lede: 20px; --lsx-badge: 14.5px; --lsx-support: 15px; --lsx-header-y: 32px; --lsx-header-x: 80px; --lsx-copy-max: 1120px; --lsx-lede-max: 740px; }
}
@media (min-width: 2560px) {
  .lsx-page { --lsx-h1: 88px; --lsx-lede: 22px; --lsx-header-x: 120px; --lsx-copy-max: 1280px; --lsx-lede-max: 800px; }
}
@media (min-width: 901px) and (max-width: 1599px) {
  .lsx-page { --lsx-h1: 54px; --lsx-lede: 16px; --lsx-header-x: 48px; --lsx-copy-max: 900px; }
}
@media (min-width: 901px) and (max-width: 1279px) {
  .lsx-page { --lsx-logo: 15px; --lsx-nav: 13px; --lsx-nav-h: 40px; --lsx-btn: 13px; --lsx-btn-h: 40px; --lsx-hero-btn-h: 40px; --lsx-h1: 42px; --lsx-lede: 15px; --lsx-badge: 12px; --lsx-support: 12px; --lsx-header-y: 16px; --lsx-header-x: 28px; --lsx-hero-gap: 88px; --lsx-copy-max: 760px; --lsx-lede-max: 560px; }
}
@media (min-width: 901px) and (max-height: 850px) {
  .lsx-page { --lsx-header-y: 14px; --lsx-hero-gap: 64px; --lsx-h1: 40px; }
}
@media (min-width: 901px) and (max-height: 720px) {
  .lsx-page { --lsx-h1: 34px; --lsx-lede: 14px; --lsx-hero-gap: 48px; --lsx-nav-h: 40px; --lsx-btn-h: 40px; --lsx-hero-btn-h: 40px; }
}

@media (min-width: 901px) {
  .lsx-page { min-height: 100vh; min-height: 100dvh; }
  /* Fill the first screen minus the header so the hero reads as a full stage
     instead of a short band above the next section. */
  .lsx-hero { min-height: calc(100vh - 90px); min-height: calc(100svh - 90px); }
}

@media (max-width: 900px) {
  .lsx-header { grid-template-columns: 1fr auto; gap: 8px; padding: 16px 18px; }
  .lsx-header-cta-wrap { display: none; }
  .lsx-burger { display: flex; }
  .lsx-site-nav { display: none; }
  .lsx-hero { padding: 48px 20px 56px; min-height: auto; }
  .lsx-page { --lsx-logo: 16px; --lsx-btn: 15px; --lsx-btn-h: 46px; --lsx-hero-btn-h: 50px; --lsx-h1: 34px; --lsx-lede: 16px; --lsx-badge: 13.5px; --lsx-support: 13px; --lsx-header-x: 18px; --lsx-hero-gap: 56px; --lsx-copy-max: 100%; --lsx-lede-max: 100%; }
  .lsx-hero h1 { line-height: 1.16; }
}

@media (max-width: 560px) {
  .lsx-page { --lsx-h1: 30px; --lsx-lede: 15.5px; --lsx-header-x: 16px; }
  .lsx-hero-actions { flex-direction: column; width: 100%; max-width: 340px; }
  .lsx-hero-actions .lsx-btn { width: 100%; }
}

@media (max-width: 380px) {
  .lsx-page { --lsx-h1: 27px; }
}

.lsx-mobile-nav-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
}
.lsx-mobile-nav-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.92);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  animation: lsx-fade-in 0.25s ease-out;
}
.lsx-mobile-nav-content {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 28px;
  padding: 48px 32px;
  width: 100%;
  max-width: 360px;
  animation: lsx-slide-up-nav 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.lsx-mobile-nav-close {
  position: absolute;
  top: 0;
  right: 0;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.1);
  background: var(--color-surface);
  color: rgba(255,255,255,0.5);
  cursor: pointer;
  transition: color 0.2s ease, background 0.2s ease;
}
.lsx-mobile-nav-close:hover {
  color: #fff;
  background: rgba(255,255,255,0.08);
}

.lsx-section {
  position: relative;
  padding: 104px 24px;
  border-top: 1px solid rgba(255,255,255,0.06);
  background: var(--color-canvas);
}
.lsx-section-inner {
  max-width: 1040px;
  margin: 0 auto;
}
.lsx-section-header {
  text-align: center;
  margin-bottom: 56px;
}
.lsx-section-label {
  display: inline-block;
  padding: 6px 14px;
  border-radius: 5px;
  border: 1px solid rgba(124,58,237,0.25);
  background: rgba(124,58,237,0.08);
  color: var(--color-accent-text);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  margin-bottom: 20px;
}
.lsx-section-title {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  font-size: clamp(28px, 3.6vw, 40px);
  font-weight: 500;
  letter-spacing: -0.03em;
  line-height: 1.15;
  color: #fff;
  margin-bottom: 14px;
  text-wrap: balance;
}
.lsx-section-subtitle {
  /* 0.45 fell just under WCAG AA (4.5:1) against the page background at 16px.
     0.5 clears it while keeping the subtitle clearly secondary to the heading. */
  color: rgba(255,255,255,0.5);
  font-size: 16px;
  line-height: 1.6;
  max-width: 560px;
  margin: 0 auto;
}

/* ── Problem / outcome ─────────────────────────────────────────────────── */
.lsx-lead-in {
  text-align: center;
  font-size: 15px;
  color: rgba(255,255,255,0.5);
  margin: -28px 0 30px;
}
.lsx-waste-grid {
  list-style: none;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  max-width: 780px;
  margin: 0 auto;
  padding: 0;
}
.lsx-waste-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 15px 18px;
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 12px;
  background: rgba(255,255,255,0.02);
  font-size: 14.5px;
  line-height: 1.35;
  color: rgba(255,255,255,0.58);
}
.lsx-waste-mark {
  display: inline-flex;
  flex-shrink: 0;
  color: rgba(239,68,68,0.7);
}
.lsx-waste-text {
  text-decoration: line-through;
  text-decoration-color: rgba(239,68,68,0.5);
  text-decoration-thickness: 1px;
}

/* ── Value engine ──────────────────────────────────────────────────────── */
.lsx-metrics {
  position: relative;
  padding: 76px 24px;
  border-top: 1px solid rgba(255,255,255,0.06);
  background:
    radial-gradient(ellipse 70% 120% at 50% 0%, rgba(124,58,237,0.12), transparent 65%),
    var(--color-canvas);
}
.lsx-metrics-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
  max-width: 1040px;
  margin: 0 auto;
  text-align: center;
}
.lsx-metric-value {
  font-size: clamp(32px, 4.4vw, 52px);
  font-weight: 500;
  letter-spacing: -0.04em;
  line-height: 1.05;
  color: #fff;
}
.lsx-metric-label {
  margin-top: 12px;
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.48);
}

/* ── Mechanism / workflow ──────────────────────────────────────────────── */
.lsx-flow-steps {
  list-style: none;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 22px;
  margin: 0;
  padding: 0;
}
.lsx-flow-step {
  position: relative;
  padding: 28px 26px 30px;
  border-radius: 18px;
  border: 1px solid rgba(255,255,255,0.07);
  background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.012));
}
.lsx-flow-step::after {
  content: '';
  position: absolute;
  top: 50%;
  right: -15px;
  width: 8px;
  height: 8px;
  border-top: 1.5px solid rgba(139,92,246,0.55);
  border-right: 1.5px solid rgba(139,92,246,0.55);
  transform: translateY(-50%) rotate(45deg);
}
.lsx-flow-step:last-child::after { display: none; }
.lsx-flow-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
}
.lsx-flow-step-num {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--color-accent-text);
}
.lsx-flow-stage {
  padding-left: 10px;
  border-left: 1px solid rgba(255,255,255,0.14);
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.42);
}
.lsx-flow-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 11px;
  background: rgba(124,58,237,0.12);
  border: 1px solid rgba(124,58,237,0.24);
  color: var(--color-accent-hover);
  margin-bottom: 18px;
}
.lsx-flow-step-title {
  font-size: 17px;
  font-weight: 500;
  letter-spacing: -0.02em;
  color: #fff;
  margin-bottom: 10px;
}
.lsx-flow-step-desc {
  font-size: 14px;
  line-height: 1.65;
  color: rgba(255,255,255,0.55);
}

/* ── Pricing ───────────────────────────────────────────────────────────── */
.lsx-plan-note {
  margin: 22px 0 24px;
  font-size: 12.5px;
  line-height: 1.5;
  color: rgba(255,255,255,0.5);
}
/* Equal-height cards leave the shorter plan with dead space, so pin each CTA
   to the card floor and let the copy above it stay top-aligned. */
.lsx-page .lsx-pricing-card { display: flex; flex-direction: column; }
.lsx-page .lsx-pricing-btn { margin-top: auto; }

/* ── Final CTA ─────────────────────────────────────────────────────────── */
.lsx-final {
  position: relative;
  padding: 104px 24px 120px;
  border-top: 1px solid rgba(255,255,255,0.06);
  text-align: center;
  background:
    radial-gradient(ellipse 60% 90% at 50% 100%, rgba(124,58,237,0.14), transparent 62%),
    var(--color-canvas);
}
.lsx-final-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 720px;
  margin: 0 auto;
}
.lsx-final-title {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  font-size: clamp(30px, 4.2vw, 48px);
  font-weight: 500;
  letter-spacing: -0.035em;
  line-height: 1.12;
  color: #fff;
  margin-bottom: 32px;
  text-wrap: balance;
}
.lsx-final-title em {
  font-family: 'Instrument Serif', 'Times New Roman', Times, serif;
  font-style: italic;
  font-weight: 400;
  font-size: 1.08em;
  letter-spacing: -0.03em;
  color: var(--color-accent-text);
}
.lsx-final-btn {
  height: auto;
  min-height: 52px;
  padding: 14px 28px;
  font-size: 15px;
  line-height: 1.25;
  white-space: normal;
  text-align: center;
}
.lsx-final .lsx-cta-support { color: rgba(255,255,255,0.5); }

@media (max-width: 900px) {
  .lsx-section { padding: 76px 20px; }
  .lsx-section-header { margin-bottom: 40px; }
  .lsx-waste-grid { grid-template-columns: 1fr; gap: 10px; }
  .lsx-metrics { padding: 56px 20px; }
  .lsx-metrics-grid { grid-template-columns: 1fr; gap: 32px; }
  .lsx-flow-steps { grid-template-columns: 1fr; gap: 34px; }
  .lsx-flow-step::after {
    top: auto;
    bottom: -21px;
    left: 50%;
    right: auto;
    transform: translateX(-50%) rotate(135deg);
  }
  .lsx-final { padding: 80px 20px 88px; }
}

@media (max-width: 700px) {
  .lsx-section { padding: 64px 20px; }
  .lsx-pricing-grid { grid-template-columns: 1fr; max-width: 400px; }
  .lsx-pricing-toggle-btn { padding: 8px 14px; font-size: 12px; }
}

.lsx-mobile-nav-links {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
}
.lsx-mobile-nav-link {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 56px;
  width: 100%;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.1);
  background: var(--color-surface);
  color: #fff;
  font-size: 19px;
  font-weight: 400;
  letter-spacing: -0.01em;
  text-decoration: none;
  font-family: inherit;
  transition: background 0.2s ease, border-color 0.2s ease;
}
.lsx-mobile-nav-link:hover {
  background: rgba(255,255,255,0.05);
}
.lsx-mobile-nav-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  padding-top: 12px;
}
.lsx-mobile-nav-btn {
  width: 100%;
  height: 52px;
  font-size: 16px;
}
@keyframes lsx-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes lsx-slide-up-nav {
  from { opacity: 0; transform: translateY(24px) scale(0.96); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.lsx-footer {
  border-top: 1px solid rgba(255,255,255,0.06);
  padding: 48px var(--lsx-header-x, 40px);
  background: var(--color-canvas);
}
.lsx-footer-bottom {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  flex-wrap: wrap;
  font-size: 12px;
  /* §8 landing contrast: was 0.3 alpha = 2.59:1 - a real AA failure on legal
     and copyright text. 0.5 lifts the composited colour to ~rgb(132,132,134)
     (5.3:1). The hover state is raised with it so the affordance stays
     clearly perceptible rather than collapsing into a near-invisible step. */
  color: rgba(255,255,255,0.5);
}
.lsx-footer-link {
  color: rgba(255,255,255,0.5);
  text-decoration: none;
  transition: color 0.2s ease;
  /* UX-007: 18px-tall legal links grow to a ≥40px hit box (no layout shift). */
  position: relative;
  /* A 12px text box is below WCAG 2.5.8's 24px target height even though the
     ::after hit area is large; give the link itself the minimum box so the
     measured target and the real target agree. */
  display: inline-flex;
  align-items: center;
  min-height: 24px;
}
.lsx-footer-link::after {
  content: '';
  position: absolute;
  inset: -11px -8px;
}
.lsx-footer-link:hover {
  color: rgba(255,255,255,0.7);
}
/* §8 landing contrast: the pricing-period colour is defined in
   src/styles/pricing.css, which is imported by BOTH this page and the studio's
   PricingModal. Editing it there would restyle the studio too, so the landing
   value is overridden here instead, scoped to .lsx-page (specificity 0,2,0
   beats the shared 0,1,0 rule). Only this page's copy changes. */
.lsx-page .lsx-pricing-period {
  color: rgba(255,255,255,0.5);
}
`,
        }}
      />

      <GrainOverlay />
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            {
              '@type': 'ListItem',
              position: 1,
              name: 'Home',
              item: SEO_CONFIG.siteUrl,
            },
            {
              '@type': 'ListItem',
              position: 2,
              name: 'Pricing',
              item: `${SEO_CONFIG.siteUrl}/#pricing`,
            },
            {
              '@type': 'ListItem',
              position: 3,
              name: 'How It Works',
              item: `${SEO_CONFIG.siteUrl}/#how-it-works`,
            },
          ],
        }}
      />
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'HowTo',
          name: 'How to record with SupersmartX Studio',
          totalTime: 'PT2M',
          step: FLOW_STEPS.map((step, i) => ({
            '@type': 'HowToStep',
            position: i + 1,
            name: step.title,
            text: step.description,
          })),
        }}
      />
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: FAQ_ITEMS.map((item) => ({
            '@type': 'Question',
            name: item.q,
            acceptedAnswer: { '@type': 'Answer', text: item.a },
          })),
        }}
      />

      <div className="lsx-page">
        <header className="lsx-header">
          <Link
            href="/"
            className="lsx-logo lsx-appear"
            style={{ '--lsx-d': '0.08s' } as React.CSSProperties}
            aria-label="SupersmartX Studio"
          >
            SUPERSMARTX
            {/* §8 landing contrast: `text-accent` (#7C3AED) is the studio's fill
   accent and measures 3.49:1 as text on this page. Lifted locally to keep the
   purple character while clearing AA; only this wordmark instance changes, so
   the accent chevrons (non-text graphics) are untouched. */}
            <span
              className="text-accent font-normal"
              style={{ color: 'rgb(146, 106, 246)' }}
            >
              Studio
            </span>
          </Link>

          <nav className="lsx-site-nav" id="lsx-site-nav" aria-label="Primary">
            {NAV_LINKS.map((link, i) => (
              <a
                key={link.label}
                href={link.href}
                className={`lsx-nav-pill lsx-appear ${i % 2 === 0 ? 'lsx-appear--scale' : 'lsx-appear--soft'}`}
                style={
                  { '--lsx-d': `${0.16 + i * 0.12}s` } as React.CSSProperties
                }
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="lsx-header-cta-wrap">
            <div
              className="lsx-appear lsx-appear--scale"
              style={{ '--lsx-d': '0.34s' } as React.CSSProperties}
            >
              {status === 'loading' ? (
                <div className="flex items-center gap-2" aria-hidden="true">
                  <div className="bg-elevated h-9 w-20 animate-pulse rounded-md" />
                  <div className="bg-elevated h-9 w-28 animate-pulse rounded-md" />
                </div>
              ) : user ? (
                <div className="relative" ref={userMenuRef}>
                  <button
                    onClick={() => setUserMenuOpen(!userMenuOpen)}
                    aria-expanded={userMenuOpen}
                    aria-haspopup="true"
                    aria-label="User menu"
                    className="bg-accent/20 text-accent hover:bg-accent/30 flex h-8 min-h-[44px] w-8 min-w-[44px] items-center justify-center overflow-hidden rounded-full text-[12px] font-bold transition-colors"
                  >
                    {user.image ? (
                      <img
                        src={user.image}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      (user.name?.[0] || user.email?.[0] || '?').toUpperCase()
                    )}
                  </button>

                  {userMenuOpen && (
                    <div
                      className="bg-surface border-border-default absolute top-full right-0 z-50 mt-1 w-56 rounded-lg border py-1 shadow-lg"
                      role="menu"
                      aria-label="User menu"
                    >
                      <div className="border-border-subtle border-b px-3 py-2">
                        <p className="text-text-primary truncate text-[12px] font-medium">
                          {user.name || 'User'}
                        </p>
                        <p className="text-text-muted truncate text-[11px]">
                          {user.email}
                        </p>
                      </div>
                      <button
                        role="menuitem"
                        onClick={() => {
                          setUserMenuOpen(false);
                          router.push('/studio');
                        }}
                        className="text-text-secondary hover:bg-elevated flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors"
                      >
                        Go to Studio
                      </button>
                      <button
                        role="menuitem"
                        onClick={async () => {
                          setUserMenuOpen(false);
                          await signOut({ callbackUrl: '/' });
                        }}
                        className="text-text-secondary hover:bg-elevated flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors"
                      >
                        Sign out
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthIntent('login');
                      setIsAuthModalOpen(true);
                    }}
                    className="lsx-btn lsx-btn-ghost"
                    style={{ marginRight: '8px' }}
                  >
                    Log in
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push('/studio')}
                    className="lsx-btn lsx-btn-solid"
                  >
                    Launch Studio
                  </button>
                </>
              )}
            </div>
          </div>

          <button
            ref={menuButtonRef}
            type="button"
            className={`lsx-burger${menuOpen ? 'is-open' : ''}`}
            aria-controls="lsx-mobile-nav"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className="lsx-burger-bar" />
            <span className="lsx-burger-bar" />
            <span className="lsx-burger-bar" />
          </button>
        </header>

        <main className="lsx-hero" id="top">
          <HeroVideo />
          <div className="lsx-hero-copy">
            <div
              className="lsx-badge lsx-appear lsx-appear--pop"
              style={{ '--lsx-d': '0.22s' } as React.CSSProperties}
            >
              <svg
                className="lsx-badge-star"
                width="18"
                height="20"
                viewBox="0 0 24 24"
                fill="white"
                aria-hidden="true"
              >
                <path d="M12 2.6C12.55 2.6 12.88 3.15 13.08 4.7c.62 4.7 1.52 5.6 6.22 6.22 1.55.2 2.1.53 2.1 1.08s-.55.88-2.1 1.08c-4.7.62-5.6 1.52-6.22 6.22-.2 1.55-.53 2.1-1.08 2.1s-.88-.55-1.08-2.1c-.62-4.7-1.52-5.6-6.22-6.22C3.15 12.88 2.6 12.55 2.6 12s.55-.88 2.1-1.08c4.7-.62 5.6-1.52 6.22-6.22C11.12 3.15 11.45 2.6 12 2.6Z" />
              </svg>
              <span>SuperSmartX Studio</span>
            </div>

            <h1>
              <span
                className="lsx-headline-line lsx-appear lsx-appear--mask"
                style={{ '--lsx-d': '0.42s' } as React.CSSProperties}
              >
                Stop Wasting{' '}
              </span>
              <span
                className="lsx-headline-line lsx-appear lsx-appear--mask"
                style={{ '--lsx-d': '0.52s' } as React.CSSProperties}
              >
                <em>3 Hours</em> Re-Recording{' '}
              </span>
              <span
                className="lsx-headline-line lsx-appear lsx-appear--mask"
                style={{ '--lsx-d': '0.62s' } as React.CSSProperties}
              >
                Video Takes.
              </span>
            </h1>

            <p
              className="lsx-lede lsx-appear lsx-appear--soft"
              style={
                {
                  '--lsx-d': '0.82s',
                  animationDuration: '1.25s',
                } as React.CSSProperties
              }
            >
              The browser-based studio that turns rough scripts into
              platform-ready Reels, Shorts, and YouTube videos in one take-with
              voice-paced prompting and zero manual timeline editing.
            </p>

            <div className="lsx-hero-actions">
              <button
                type="button"
                onClick={() => router.push('/studio')}
                className="lsx-btn lsx-btn-solid lsx-hero-btn lsx-hero-cta lsx-appear lsx-appear--btn"
                style={{ '--lsx-d': '0.96s' } as React.CSSProperties}
              >
                Launch Studio in Browser - No Card Required
              </button>
              <button
                type="button"
                onClick={() => {
                  document
                    .getElementById('how-it-works')
                    ?.scrollIntoView({ behavior: 'smooth' });
                }}
                className="lsx-btn lsx-btn-ghost lsx-hero-btn lsx-hero-ghost lsx-appear lsx-appear--btn"
                style={{ '--lsx-d': '1.06s' } as React.CSSProperties}
              >
                See how it works
              </button>
            </div>

            <p
              className="lsx-cta-support lsx-appear lsx-appear--soft"
              style={{ '--lsx-d': '1.16s' } as React.CSSProperties}
            >
              Ready in 30 seconds · No downloads or installs required
            </p>
          </div>
        </main>

        <section
          className="lsx-section"
          id="operational-waste"
          aria-labelledby="waste-title"
        >
          <div className="lsx-section-inner">
            <div className="lsx-section-header">
              <span className="lsx-section-label">Operational waste</span>
              <h2 id="waste-title" className="lsx-section-title">
                Creators do not want another recording tool.
              </h2>
            </div>
            <p className="lsx-lead-in">They want to eliminate:</p>
            <ul className="lsx-waste-grid">
              {WASTE_ITEMS.map((item) => (
                <li key={item} className="lsx-waste-item">
                  <span className="lsx-waste-mark" aria-hidden="true">
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </span>
                  <span className="lsx-waste-text">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="lsx-metrics" aria-label="Product outcomes">
          <div className="lsx-metrics-grid">
            {METRICS.map((metric) => (
              <div key={metric.value} className="lsx-metric">
                <p className="lsx-metric-value">{metric.value}</p>
                <p className="lsx-metric-label">{metric.label}</p>
              </div>
            ))}
          </div>
        </section>

        <section
          className="lsx-section"
          id="how-it-works"
          aria-labelledby="flow-title"
        >
          <div className="lsx-section-inner">
            <div className="lsx-section-header">
              <span className="lsx-section-label">How it works</span>
              <h2 id="flow-title" className="lsx-section-title">
                Script → Record → Publish
              </h2>
              <p className="lsx-section-subtitle">
                Voice-paced prompting + precision capture + instant multi-format
                export.
              </p>
            </div>
            <ol className="lsx-flow-steps">
              {FLOW_STEPS.map((step, i) => (
                <li key={step.title} className="lsx-flow-step">
                  <div className="lsx-flow-head">
                    <span className="lsx-flow-step-num">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="lsx-flow-stage">{step.stage}</span>
                  </div>
                  <div className="lsx-flow-icon">
                    <FlowStepIcon index={i} />
                  </div>
                  <h3 className="lsx-flow-step-title">{step.title}</h3>
                  <p className="lsx-flow-step-desc">{step.description}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section
          className="lsx-section lsx-pricing"
          id="pricing"
          aria-labelledby="pricing-title"
        >
          <div className="lsx-section-inner">
            <div className="lsx-section-header">
              <span className="lsx-section-label">Pricing</span>
              <h2 id="pricing-title" className="lsx-section-title">
                Start free. Upgrade when ready.
              </h2>
              <p className="lsx-section-subtitle">
                One-time payment - no automatic renewal.
              </p>
            </div>

            {/* Billing period toggle */}
            <div
              className="lsx-pricing-toggle"
              role="group"
              aria-label="Billing period"
            >
              <button
                type="button"
                onClick={() => setBillingPeriod('monthly')}
                aria-pressed={billingPeriod === 'monthly'}
                className={`lsx-pricing-toggle-btn ${billingPeriod === 'monthly' ? 'lsx-pricing-toggle-btn--active' : ''}`}
              >
                1 month
              </button>
              <button
                type="button"
                onClick={() => setBillingPeriod('yearly')}
                aria-pressed={billingPeriod === 'yearly'}
                className={`lsx-pricing-toggle-btn ${billingPeriod === 'yearly' ? 'lsx-pricing-toggle-btn--active' : ''}`}
              >
                1 year{' '}
                <span className="lsx-pricing-toggle-save">
                  {formatSavingsPercent(
                    currentPricing.creatorMonthly,
                    currentPricing.creatorYearly,
                  )}
                </span>
              </button>
            </div>

            <div className="lsx-pricing-grid">
              <div className="lsx-pricing-card">
                <div className="lsx-pricing-card-header">
                  <h3 className="lsx-pricing-plan">Free Plan</h3>
                  <div className="lsx-pricing-price">
                    {formatZero(0)}
                    <span className="lsx-pricing-period">/forever</span>
                  </div>
                </div>
                <ul className="lsx-pricing-features">
                  {FREE_FEATURES.map((text) => (
                    <li key={text} className="lsx-pricing-feature">
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--color-accent)"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      {text}
                    </li>
                  ))}
                </ul>
                <p className="lsx-plan-note">
                  Ideal for testing browser compatibility
                </p>
                <button
                  type="button"
                  onClick={() => router.push('/studio')}
                  className="lsx-btn lsx-btn-ghost lsx-pricing-btn"
                >
                  {PRICING_PLANS.free.cta}
                </button>
              </div>
              <div className="lsx-pricing-card lsx-pricing-card--pro">
                <div className="lsx-pricing-badge">High-ROI Tier</div>
                <div className="lsx-pricing-card-header">
                  <h3 className="lsx-pricing-plan">Creator Pro</h3>
                  <div className="lsx-pricing-price">
                    {format(
                      billingPeriod === 'monthly'
                        ? currentPricing.creatorMonthly
                        : currentPricing.creatorYearly,
                    )}
                    <span className="lsx-pricing-period">
                      {' '}
                      for {billingPeriod === 'monthly' ? '1 month' : '1 year'}
                    </span>
                  </div>
                  {billingPeriod === 'yearly' && (
                    <p className="lsx-pricing-note">
                      One-time payment for 1 year of access (equivalent to{' '}
                      {format(currentPricing.creatorYearly / 12)}/month).
                    </p>
                  )}
                  {billingPeriod === 'monthly' && (
                    <p className="lsx-pricing-note">
                      One-time payment for 1 month of access.
                    </p>
                  )}
                </div>
                <ul className="lsx-pricing-features">
                  {CREATOR_FEATURES.map((text, i) => (
                    <li
                      key={text}
                      className={`lsx-pricing-feature ${i === 0 ? 'lsx-pricing-feature--highlight' : ''}`}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--color-accent)"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      {text}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={handleCreatorClick}
                  className="lsx-btn lsx-btn-solid lsx-pricing-btn"
                >
                  {PRICING_PLANS.creator.cta}
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="lsx-section" id="faq" aria-labelledby="faq-title">
          <div className="lsx-section-inner">
            <div className="lsx-section-header">
              <span className="lsx-section-label">FAQ</span>
              <h2 id="faq-title" className="lsx-section-title">
                Everything that holds creators back
              </h2>
              <p className="lsx-section-subtitle">
                Hardware, browser performance, speed and editing - answered
                before you start.
              </p>
            </div>
            <div className="mx-auto max-w-3xl space-y-4 text-left">
              {FAQ_ITEMS.map((item) => (
                <details
                  key={item.q}
                  className="group rounded-xl border border-white/5 bg-white/[0.02] p-5 open:bg-white/[0.03]"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
                    <h3 className="text-[15px] font-medium text-white">
                      {item.q}
                    </h3>
                    <span className="text-accent transition-transform group-open:rotate-180">
                      ⌃
                    </span>
                  </summary>
                  <p className="mt-3 text-[14px] leading-relaxed text-white/60">
                    {item.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="lsx-final" aria-labelledby="final-cta-title">
          <div className="lsx-final-inner">
            <h2 id="final-cta-title" className="lsx-final-title">
              Platform-ready videos <em>in one take</em>.
            </h2>
            <button
              type="button"
              onClick={() => router.push('/studio')}
              className="lsx-btn lsx-btn-solid lsx-final-btn"
            >
              Launch Studio in Browser - No Card Required
            </button>
            <p className="lsx-cta-support">
              Ready in 30 seconds · No downloads or installs required
            </p>
          </div>
        </section>

        <footer className="lsx-footer">
          <div className="lsx-footer-bottom">
            <span>
              &copy; {new Date().getFullYear()} SupersmartX. All rights
              reserved.
            </span>
            <Link href="/legal/terms" className="lsx-footer-link">
              Terms
            </Link>
            <Link href="/legal/privacy" className="lsx-footer-link">
              Privacy
            </Link>
          </div>
        </footer>
      </div>

      <AuthModal
        isOpen={isAuthModalOpen}
        intent={authIntent}
        onClose={() => setIsAuthModalOpen(false)}
        callbackUrl={creatorCallbackUrl}
        onSuccess={handleLandingAuthSuccess}
      />

      {menuOpen && (
        <div
          ref={menuRef}
          id="lsx-mobile-nav"
          className="lsx-mobile-nav-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
        >
          {/* Purely decorative click-to-dismiss layer. It must NOT be a focusable
              control: it carried the same accessible name as the real Close
              button ("Close menu"), which made that name ambiguous, and added a
              phantom tab stop to a transparent overlay. aria-hidden + no tabIndex
              removes both; the Close button below is the keyboard path. */}
          <div
            className="lsx-mobile-nav-backdrop"
            onClick={dismissMenu}
            aria-hidden="true"
          />
          <div className="lsx-mobile-nav-content">
            <button
              type="button"
              className="lsx-mobile-nav-close"
              onClick={dismissMenu}
              aria-label="Close navigation menu"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <nav
              className="lsx-mobile-nav-links"
              aria-label="Mobile navigation"
            >
              {NAV_LINKS.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  className="lsx-mobile-nav-link"
                  onClick={closeMenu}
                >
                  {link.label}
                </a>
              ))}
            </nav>
            <div className="lsx-mobile-nav-actions">
              <button
                type="button"
                onClick={() => {
                  setAuthIntent('login');
                  setIsAuthModalOpen(true);
                  closeMenu();
                }}
                className="lsx-btn lsx-btn-ghost lsx-mobile-nav-btn"
              >
                Log in
              </button>
              <button
                type="button"
                onClick={() => {
                  router.push('/studio');
                  closeMenu();
                }}
                className="lsx-btn lsx-btn-solid lsx-mobile-nav-btn"
              >
                Launch Studio
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
