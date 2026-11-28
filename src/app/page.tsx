'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { AuthModal } from '@/components/auth/AuthModal';
import {
  formatPrice,
  formatPriceZero,
  formatSavingsPercent,
} from '@/lib/pricing';
import { useRegionalPricing } from '@/hooks/useRegionalPricing';
import { PRICING_PLANS } from '@/constants';
import { JsonLd } from '@/components/seo/JsonLd';
import { SEO_CONFIG } from '@/lib/seo/config';
import '@/styles/pricing.css';
import '@/styles/landing.css';

const NAV_LINKS = [
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
    a: 'No. There is no timeline to edit. Creator renders native, perfectly framed 9:16, 16:9 and 1:1 ratios without re-cropping footage or touching timeline software.',
  },
  {
    q: 'What do I need to get started?',
    a: 'A browser, a camera and a microphone. Ready in 30 seconds · No downloads or installs required.',
  },
  {
    q: 'How much does SupersmartX Studio cost?',
    a: 'Free forever with a standard teleprompter (3 minutes per recording), YouTube 16:9, 720p, unlimited local downloads and watermark. Free recording is limited to up to 10 minutes per browser profile per local calendar day. This is a device-local limit and may reset if site data is cleared or you switch browser profiles. Creator is a monthly or yearly subscription that renews automatically until canceled. Canceling stops future renewals, and access continues through the paid period.',
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cdnFailed, setCdnFailed] = useState(false);

  // The looping clip is decoration. Visitors who ask the OS for reduced
  // motion get a still first frame instead of a permanently moving backdrop;
  // the scrim keeps the copy readable either way.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      if (mediaQuery.matches) {
        video.pause();
      } else {
        // jsdom's play() returns undefined; real browsers return a promise.
        const playback = video.play();
        if (playback) playback.catch(() => {});
      }
    };
    apply();
    mediaQuery.addEventListener('change', apply);
    return () => mediaQuery.removeEventListener('change', apply);
  }, []);

  return (
    <div className={`lsx-hero-photo ${cdnFailed ? 'lsx-hero-photo--fallback' : ''}`} aria-hidden="true">
      {!cdnFailed && (
        <video ref={videoRef} autoPlay muted loop playsInline preload="auto">
          <source
            src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260818_072341_50851634-bbc3-4c33-9acc-7647d4db44aa.mp4"
            type="video/mp4"
            onError={() => setCdnFailed(true)}
          />
        </video>
      )}
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
  const { data: session, status, update: refreshSession } = useSession();

  // A logout in another open tab is broadcast by Auth.js, but the landing
  // page can otherwise keep its previous client snapshot until navigation or
  // the next polling interval. Refresh when this page becomes visible so the
  // account menu never presents stale authentication state.
  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshSession();
    };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [refreshSession]);
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

  // A completed password reset hands off here: the reset page stores
  // sxs-open-login and links to "/" with a "Log in" label, so honor the label
  // by opening the sign-in step instead of dropping the user on the hero.
  useEffect(() => {
    try {
      if (sessionStorage.getItem('sxs-open-login') === '1') {
        sessionStorage.removeItem('sxs-open-login');
        setAuthIntent('login');
        setIsAuthModalOpen(true);
      }
    } catch {}
  }, []);

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

  // The server owns the advertised amount (USD everywhere except India), and
  // this is the same hook the checkout sheet uses, so the price shown here is
  // the price the server will charge.
  const { pricing: currentPricing } = useRegionalPricing();
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
            className={`lsx-burger ${menuOpen ? 'is-open' : ''}`}
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
                Creator subscriptions renew automatically until canceled.
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
                  <h3 className="lsx-pricing-plan">Free</h3>
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
                <div className="lsx-pricing-badge">Most Popular</div>
                <div className="lsx-pricing-card-header">
                  <h3 className="lsx-pricing-plan">Creator</h3>
                  <div className="lsx-pricing-price">
                    {format(
                      billingPeriod === 'monthly'
                        ? currentPricing.creatorMonthly
                        : currentPricing.creatorYearly,
                    )}
                    <span className="lsx-pricing-period">
                      {' '}
                      / {billingPeriod === 'monthly' ? 'month' : 'year'}
                    </span>
                  </div>
                  {billingPeriod === 'yearly' && (
                    <p className="lsx-pricing-note">
                      Renews every 12 months until canceled (equivalent to{' '}
                      {format(currentPricing.creatorYearly / 12)}/month).
                    </p>
                  )}
                  {billingPeriod === 'monthly' && (
                    <p className="lsx-pricing-note">
                      Renews every month until canceled.
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
          <div className="lsx-footer-info">
            <p className="lsx-footer-info-title">SupersmartX Studio</p>
            <p className="lsx-footer-info-line">
              {`Browser-based teleprompter and video recording. Plans: Free (${formatZero(0)}), Creator (${format(currentPricing.creatorMonthly)} per month or ${format(currentPricing.creatorYearly)} per year).`}
            </p>
            <p className="lsx-footer-info-line">
              Operated by SupersmartX, India &middot;{' '}
              <a
                href="mailto:support@supersmartx.com"
                className="lsx-footer-info-link"
              >
                support@supersmartx.com
              </a>
            </p>
          </div>
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
            <Link href="/legal/refund" className="lsx-footer-link">
              Refunds &amp; Cancellations
            </Link>
            <Link href="/contact" className="lsx-footer-link">
              Contact
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
