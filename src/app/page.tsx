'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { AuthModal } from '@/components/auth/AuthModal';

const NAV_LINKS = [
  { label: 'Features', href: '#features' },
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'Contact', href: '#contact' },
];

const STATS = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <rect x="3.4" y="2.6" width="7.2" height="18.8" rx="3.6" fill="url(#stat1a)" />
        <rect x="13.4" y="2.6" width="7.2" height="18.8" rx="3.6" fill="url(#stat1b)" />
        <rect x="9.2" y="10.9" width="5.6" height="2.2" rx="1.1" fill="#4a4a4a" />
        <defs>
          <linearGradient id="stat1a" x1="3" y1="2" x2="14" y2="22">
            <stop offset="0" stopColor="#fff" stopOpacity="0.38" />
            <stop offset="1" stopColor="#3a3a3a" stopOpacity="0.62" />
          </linearGradient>
          <linearGradient id="stat1b" x1="14" y1="2" x2="25" y2="22">
            <stop offset="0" stopColor="#3a3a3a" stopOpacity="0.38" />
            <stop offset="1" stopColor="#fff" stopOpacity="0.62" />
          </linearGradient>
        </defs>
      </svg>
    ),
    label: '50K+ scripts written',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <rect x="2.4" y="2.4" width="19.2" height="19.2" rx="6.2" fill="#fff" />
        <path d="M12 7.1v7.4M8.15 12.35L12 16.2l3.85-3.85" stroke="#111" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    label: '4K video recording',
  },
  {
    icon: (
      <svg width="38" height="21" viewBox="0 0 40 22" fill="none" className="stat-icon-wide">
        <circle cx="10.2" cy="11" r="9.2" fill="#2b2b2b" />
        <ellipse cx="10.2" cy="12.1" rx="4.15" ry="3.7" fill="#f4f4f4" />
        <circle cx="8.5" cy="11.2" r="0.7" fill="#1a1a1a" />
        <circle cx="11.9" cy="11.2" r="0.7" fill="#1a1a1a" />
        <circle cx="20.2" cy="11" r="9.2" fill="#fff" />
        <circle cx="18.5" cy="9.5" r="1.7" fill="#1a1a1a" />
        <circle cx="21.9" cy="9.5" r="1.7" fill="#1a1a1a" />
        <ellipse cx="20.2" cy="12" rx="1.5" ry="1.2" fill="#ddd" />
        <path d="M17.5 14.5c.9 1.2 2.4 1.8 2.7 1.8s1.8-.6 2.7-1.8" stroke="#111" strokeWidth="1.2" strokeLinecap="round" fill="none" />
        <circle cx="30.2" cy="11" r="9.2" fill="#f26b1d" />
        <text x="30.2" y="15.1" textAnchor="middle" fill="#fff" fontFamily="Inter, sans-serif" fontWeight="700" fontSize="12.5">S</text>
      </svg>
    ),
    label: '10K+ creators onboarded',
  },
];

function GrainOverlay() {
  return (
    <div
      className="grain"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        pointerEvents: 'none',
        opacity: 0.035,
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'repeat',
      }}
    />
  );
}

function HeroVideo() {
  return (
    <div className="hero-photo" style={{ position: 'fixed', inset: 0, zIndex: 0 }}>
      <video
        autoPlay
        muted
        loop
        playsInline
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      >
        <source
          src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260818_072341_50851634-bbc3-4c33-9acc-7647d4db44aa.mp4"
          type="video/mp4"
        />
      </video>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.5) 100%)',
        }}
      />
    </div>
  );
}

export default function LandingPage() {
  const { data: session } = useSession();
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useEffect(() => {
    if (menuOpen) {
      document.body.classList.add('menu-open');
    } else {
      document.body.classList.remove('menu-open');
    }
    return () => document.body.classList.remove('menu-open');
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
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    if (menuOpen) {
      document.addEventListener('keydown', handleKey);
      return () => document.removeEventListener('keydown', handleKey);
    }
  }, [menuOpen, closeMenu]);

  useEffect(() => {
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const appears = document.querySelectorAll<HTMLElement>('.appear');
        const heroPhoto = document.querySelector('.hero-photo');
        let needsFallback = false;

        appears.forEach((el) => {
          const anims = el.getAnimations();
          if (anims.length === 0) {
            el.classList.add('is-in');
          } else {
            el.addEventListener(
              'animationend',
              () => el.classList.add('is-in'),
              { once: true }
            );
          }
        });

        if (heroPhoto) {
          const anims = heroPhoto.getAnimations();
          if (anims.length === 0) {
            heroPhoto.classList.add('is-in');
          } else {
            heroPhoto.addEventListener(
              'animationend',
              () => heroPhoto.classList.add('is-in'),
              { once: true }
            );
          }
        }

        setTimeout(() => {
          appears.forEach((el) => {
            if (!el.classList.contains('is-in')) el.classList.add('is-in');
          });
          if (heroPhoto && !heroPhoto.classList.contains('is-in')) {
            heroPhoto.classList.add('is-in');
          }
        }, 2500);
      });
    });
    return () => cancelAnimationFrame(raf1);
  }, []);

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
@import url('https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=Instrument+Serif:ital@1&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #000000 !important; color: #ffffff; background: #000000; background: var(--bg, #000000); color: #ffffff; color: var(--text, #ffffff); }
html { scroll-behavior: smooth; }
a { color: inherit; text-decoration: none; }
button { font-family: inherit; }
body {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  overflow-x: hidden;
  position: relative;
}

:root {
  --bg: #000000;
  --text: #ffffff;
  --muted: #9a9a9a;
  --stat: #d8d8d8;
  --border: rgba(255, 255, 255, 0.16);
  --border-soft: rgba(255, 255, 255, 0.12);
  --logo: 15.5px;
  --logo-mark: 22px;
  --nav: 14px;
  --nav-h: 40px;
  --btn: 13.5px;
  --btn-h: 40px;
  --hero-btn-h: 42px;
  --h1: 48px;
  --lede: 15.5px;
  --badge: 12.5px;
  --stat-size: 13.5px;
  --header-y: 22px;
  --header-x: 40px;
  --stats-x: 72px;
  --stats-y: 36px;
  --hero-gap: 85px;
  --copy-max: 860px;
  --lede-max: 470px;
}

.hero-photo { opacity: 0; transition: opacity 1.05s cubic-bezier(0.16, 1, 0.3, 1); }
.hero-photo.is-in { opacity: 1; }

.page {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-rows: auto 1fr auto;
  min-height: 100vh;
  min-height: 100dvh;
}

.header {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  padding: var(--header-y) var(--header-x) 10px;
  z-index: 50;
  position: relative;
}

.logo {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  justify-self: start;
  font-size: var(--logo);
  font-weight: 600;
  letter-spacing: -0.03em;
  color: #fff;
}
.logo-suffix { font-weight: 400; }

#site-nav {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-self: center;
}

.nav-pill {
  height: var(--nav-h);
  padding: 0 18px;
  border-radius: 7px;
  overflow: hidden;
  position: relative;
  border: 1px solid rgba(198,198,198,0.55);
  background: linear-gradient(105deg, #050505 0%, #2a2a2a 48%, #4a4a4a 100%);
  color: #f3f3f3;
  font-size: var(--nav);
  font-weight: 400;
  letter-spacing: -0.01em;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.35s ease, border-color 0.35s ease, box-shadow 0.35s ease;
}
.nav-pill::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.16) 50%, transparent 70%);
  transform: translateX(-120%);
  transition: transform 0.6s ease;
  z-index: 1;
}
.nav-pill:hover::before { transform: translateX(120%); }
.nav-pill:hover {
  border-color: rgba(235,235,235,0.9);
  background: linear-gradient(105deg, #111 0%, #3a3a3a 45%, #6a6a6a 100%);
  box-shadow: 0 0 18px rgba(200,210,230,0.18);
}

.header-cta-wrap { justify-self: end; }

.btn {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: var(--btn-h);
  padding: 0 16px;
  border-radius: 6px;
  font-size: var(--btn);
  font-weight: 500;
  letter-spacing: -0.02em;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.35s ease, border-color 0.35s ease, box-shadow 0.35s ease, color 0.35s ease, filter 0.35s ease;
}
.btn::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(115deg, transparent 20%, rgba(255,255,255,0.45) 48%, transparent 76%);
  transform: translateX(-130%);
  transition: transform 0.65s ease;
  z-index: 1;
  pointer-events: none;
}
.btn:hover::after { transform: translateX(130%); }

.btn-solid {
  background: linear-gradient(180deg, #ffffff 0%, #e7e7e7 48%, #cfcfcf 100%);
  color: #111;
  border: 1px solid #fff;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.95);
}
.btn-solid:hover {
  background: linear-gradient(180deg, #fff 0%, #f3f6ff 42%, #d5def2 100%);
  border-color: #f2f6ff;
  box-shadow: inset 0 1px 0 #fff, 0 0 22px rgba(186,208,255,0.35), 0 8px 18px rgba(255,255,255,0.12);
}

.btn-ghost {
  background: linear-gradient(135deg, rgba(255,255,255,0.1), rgba(0,0,0,0.45) 50%, rgba(160,175,200,0.08));
  color: #fff;
  border: 1px solid rgba(198,198,198,0.45);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.12);
}
.btn-ghost:hover {
  background: linear-gradient(135deg, rgba(210,225,255,0.18), rgba(0,0,0,0.35) 48%, rgba(180,195,220,0.16));
  border-color: rgba(220,230,255,0.75);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.22), 0 0 20px rgba(170,200,255,0.22);
}

.hero-btn {
  height: var(--hero-btn-h);
  padding: 0 18px;
}
.hero-solid:hover {
  box-shadow: inset 0 1px 0 #fff, 0 0 26px rgba(186,208,255,0.4), 0 8px 18px rgba(255,255,255,0.14);
}
.hero-ghost {
  background: linear-gradient(135deg, rgba(255,255,255,0.12), rgba(0,0,0,0.5) 46%, rgba(150,170,200,0.1));
  border: 1px solid rgba(198,198,198,0.55);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}
.hero-ghost:hover {
  box-shadow: 0 0 24px rgba(170,200,255,0.28), inset 0 1px 0 rgba(255,255,255,0.22);
  border-color: rgba(220,230,255,0.8);
}

.hero {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 8px 24px var(--hero-gap);
  min-height: 0;
}

.hero-copy {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  max-width: var(--copy-max);
  width: 100%;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 22px;
  padding: 9px 15px;
  border: 0;
  border-radius: 5px;
  background: linear-gradient(90deg, #7d7d7d 0%, #2a2a2a 52%, #0a0a0a 100%);
  color: #f2f2f2;
  font-size: var(--badge);
  font-weight: 400;
  letter-spacing: -0.01em;
}
.badge-star {
  filter: drop-shadow(0 0 3px rgba(255,255,255,0.45));
}

.hero h1 {
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: var(--h1);
  font-weight: 500;
  letter-spacing: -0.045em;
  line-height: 1.12;
  color: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
}

.headline-line {
  display: block;
  overflow: hidden;
  padding: 0.06em 0.15em 0.14em;
}

.headline-line em {
  font-family: 'Instrument Serif', 'Times New Roman', Times, serif;
  font-style: italic;
  font-weight: 400;
  font-size: 1.08em;
  letter-spacing: -0.03em;
  color: #9a9a9a;
}

.lede {
  max-width: var(--lede-max);
  margin-top: 18px;
  color: #9a9a9a;
  font-size: var(--lede);
  font-weight: 400;
  line-height: 1.55;
  letter-spacing: -0.015em;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  margin-top: 26px;
}

.stats {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 0 var(--stats-x) var(--stats-y);
  padding-bottom: max(var(--stats-y), env(safe-area-inset-bottom));
  color: #d8d8d8;
}

.stat {
  display: inline-flex;
  align-items: center;
  gap: 14px;
  font-size: var(--stat-size);
  letter-spacing: -0.015em;
  white-space: nowrap;
}

.menu-backdrop {
  display: block;
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgba(8,8,8,0.42);
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.28s ease, visibility 0.28s ease;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
body.menu-open .menu-backdrop {
  opacity: 1;
  visibility: visible;
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
}

.burger {
  display: none;
  width: 42px;
  height: 42px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: rgba(8,8,8,0.55);
  z-index: 60;
  cursor: pointer;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0;
}
.burger-bar {
  display: block;
  width: 16px;
  height: 1.5px;
  background: #fff;
  border-radius: 1px;
  transition: transform 0.25s ease, opacity 0.2s ease;
}
body.menu-open .burger-bar:nth-child(1) {
  transform: translateY(6.5px) rotate(45deg);
}
body.menu-open .burger-bar:nth-child(2) {
  opacity: 0;
}
body.menu-open .burger-bar:nth-child(3) {
  transform: translateY(-6.5px) rotate(-45deg);
}
.burger:hover {
  border-color: rgba(255,255,255,0.32);
  background: rgba(255,255,255,0.05);
}

.appear { opacity: 1; animation-duration: 1.05s; animation-fill-mode: both; animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1); animation-delay: var(--d, 0.08s); }
.appear.is-in { animation: none; opacity: 1; transform: none; clip-path: none; filter: none; }

.appear--scale { animation-name: in-scale; }
.appear--soft { animation-name: in-soft; }
.appear--mask { animation-name: in-mask; }
.appear--pop { animation-name: in-pop; }
.appear--btn { animation-name: in-btn; }
.appear--side { animation-name: in-side; }
.appear--stat { animation-name: in-stat; }

.badge-star { animation: in-star 0.9s 0.28s both cubic-bezier(0.16, 1, 0.3, 1); }
.badge-star.is-in { animation: none; }
.hero h1 em { animation: in-em 1.2s 0.72s both cubic-bezier(0.16, 1, 0.3, 1); }
.hero h1 em.is-in { animation: none; opacity: 1; filter: none; }

@keyframes in-scale { from { opacity: 0; transform: scale(0.84); } }
@keyframes in-soft { from { opacity: 0; transform: translateY(14px); } }
@keyframes in-mask { from { opacity: 0; transform: translateY(40%); } }
@keyframes in-pop { 0% { opacity: 0; transform: scale(0.9); } 70% { transform: scale(1.03); } 100% { opacity: 1; transform: scale(1); } }
@keyframes in-btn { from { opacity: 0; transform: translateY(18px) scale(0.94); } }
@keyframes in-side { from { opacity: 0; transform: translateX(22px); } }
@keyframes in-stat { from { opacity: 0; transform: translateY(20px); } }
@keyframes in-star { 0% { opacity: 0; transform: scale(0.2) rotate(-50deg); } 65% { opacity: 1; transform: scale(1.2) rotate(8deg); } 100% { opacity: 1; transform: scale(1) rotate(0deg); } }
@keyframes in-em { from { opacity: 0.35; filter: blur(4px); } }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; }
  .appear, .hero-photo, .hero h1 em, .badge-star { opacity: 1; transform: none; clip-path: none; filter: none; }
}

@media (min-width: 1600px) {
  :root {
    --logo: 17px; --logo-mark: 24px; --nav: 15px; --nav-h: 44px;
    --btn: 15px; --btn-h: 44px; --hero-btn-h: 48px; --h1: 64px;
    --lede: 18px; --badge: 13.5px; --stat-size: 15px;
    --header-y: 28px; --header-x: 64px; --stats-x: 96px; --stats-y: 44px;
    --copy-max: 980px; --lede-max: 540px;
  }
}

@media (min-width: 1920px) {
  :root {
    --logo: 18px; --logo-mark: 26px; --nav: 16px; --nav-h: 48px;
    --btn: 16px; --btn-h: 48px; --hero-btn-h: 52px; --h1: 76px;
    --lede: 20px; --badge: 14.5px; --stat-size: 16px;
    --header-y: 32px; --header-x: 80px; --stats-x: 120px; --stats-y: 52px;
    --copy-max: 1120px; --lede-max: 620px;
  }
}

@media (min-width: 2560px) {
  :root {
    --h1: 88px; --lede: 22px;
    --header-x: 120px; --stats-x: 160px;
    --copy-max: 1280px; --lede-max: 680px;
  }
}

@media (min-width: 901px) and (max-width: 1599px) {
  :root {
    --h1: 54px; --lede: 16px;
    --header-x: 48px; --stats-x: 80px;
    --copy-max: 900px;
  }
}

@media (min-width: 901px) and (max-width: 1279px) {
  :root {
    --logo: 15px; --nav: 13px; --nav-h: 36px;
    --btn: 13px; --btn-h: 38px; --hero-btn-h: 40px;
    --h1: 42px; --lede: 15px; --badge: 12px; --stat-size: 12.5px;
    --header-y: 16px; --header-x: 28px; --stats-x: 36px; --stats-y: 28px;
    --hero-gap: 64px; --copy-max: 760px; --lede-max: 440px;
  }
}

@media (min-width: 901px) and (max-height: 850px) {
  :root {
    --header-y: 14px; --stats-y: 24px; --hero-gap: 48px; --h1: 40px;
  }
}

@media (min-width: 901px) and (max-height: 720px) {
  :root {
    --h1: 34px; --lede: 14px; --hero-gap: 32px; --stats-y: 18px;
    --nav-h: 30px; --btn-h: 34px; --hero-btn-h: 36px;
  }
}

@media (min-width: 901px) {
  html, body { height: 100%; overflow: hidden; }
  .page { height: 100vh; height: 100dvh; overflow: hidden; }
}

@media (max-width: 900px) {
  html, body { height: auto; overflow-y: auto; }
  .header {
    grid-template-columns: 1fr auto auto;
    gap: 8px;
    padding: 16px 18px;
  }
  .burger { display: flex; }
  #site-nav {
    position: fixed;
    inset: 0;
    z-index: 45;
    flex-direction: column;
    background: transparent;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 96px 22px 32px;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.28s ease, visibility 0.28s ease;
  }
  body.menu-open #site-nav {
    opacity: 1;
    visibility: visible;
  }
  #site-nav .nav-pill {
    width: 100%;
    height: 56px;
    font-size: 19px;
    border-radius: 10px;
  }
  .hero {
    padding: 20px 20px 64px;
    align-items: flex-end;
  }
  .stats {
    flex-direction: column;
    align-items: center;
    gap: 16px;
    white-space: normal;
    padding: 20px 24px 48px;
  }
  :root {
    --logo: 16px;
    --btn: 15px; --btn-h: 46px; --hero-btn-h: 48px;
    --h1: 36px; --lede: 16.5px; --badge: 13.5px; --stat-size: 15px;
    --header-x: 18px; --stats-x: 20px; --stats-y: 28px;
    --hero-gap: 36px;
    --copy-max: 100%; --lede-max: 100%;
  }
}

@media (max-width: 560px) {
  :root {
    --h1: 34px; --lede: 16px; --header-x: 16px;
  }
  .hero-actions {
    flex-direction: column;
    width: 100%;
  }
  .hero-actions .btn {
    width: 100%;
  }
}
`,
        }}
      />

      <GrainOverlay />
      <HeroVideo />

      <div className="page" ref={pageRef}>
        <div className="menu-backdrop" onClick={closeMenu} />

        <header className="header">
          <Link href="/" className="logo appear" style={{ '--d': '0.08s' } as React.CSSProperties} aria-label="SupersmartX Studio">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <g transform="rotate(-30 12 12)">
                <circle cx="7.3" cy="3.2" r="1.45" />
                <rect x="5.5" y="4.7" width="3.6" height="14.6" rx="1.8" />
                <rect x="14.9" y="4.7" width="3.6" height="14.6" rx="1.8" />
                <circle cx="16.7" cy="20.8" r="1.45" />
              </g>
            </svg>
            <span>SuperSmart<span className="logo-suffix">X</span></span>
          </Link>

          <nav id="site-nav" aria-label="Primary">
            {NAV_LINKS.map((link, i) => (
              <a
                key={link.label}
                href={link.href}
                className={`nav-pill appear ${i % 2 === 0 ? 'appear--scale' : 'appear--soft'}`}
                style={{ '--d': `${0.16 + i * 0.12}s` } as React.CSSProperties}
                onClick={closeMenu}
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="header-cta-wrap">
            {session?.user ? (
              <Link
                href="/studio"
                className="btn btn-solid appear appear--scale header-cta"
                style={{ '--d': '0.34s' } as React.CSSProperties}
              >
                Open Studio
              </Link>
            ) : (
              <button
                onClick={() => { setIsAuthModalOpen(true); closeMenu(); }}
                className="btn btn-solid appear appear--scale header-cta"
                style={{ '--d': '0.34s' } as React.CSSProperties}
              >
                Start for Free
              </button>
            )}
          </div>

          <button
            className="burger"
            aria-controls="site-nav"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className="burger-bar" />
            <span className="burger-bar" />
            <span className="burger-bar" />
          </button>
        </header>

        <main className="hero" id="top">
          <div className="hero-copy">
            <div className="badge appear appear--pop" style={{ '--d': '0.22s' } as React.CSSProperties}>
              <svg className="badge-star" width="18" height="20" viewBox="0 0 24 24" fill="white">
                <path d="M12 2.6C12.55 2.6 12.88 3.15 13.08 4.7c.62 4.7 1.52 5.6 6.22 6.22 1.55.2 2.1.53 2.1 1.08s-.55.88-2.1 1.08c-4.7.62-5.6 1.52-6.22 6.22-.2 1.55-.53 2.1-1.08 2.1s-.88-.55-1.08-2.1c-.62-4.7-1.52-5.6-6.22-6.22C3.15 12.88 2.6 12.55 2.6 12s.55-.88 2.1-1.08c4.7-.62 5.6-1.52 6.22-6.22C11.12 3.15 11.45 2.6 12 2.6Z" />
              </svg>
              <span>Browser-based Teleprompter Studio</span>
            </div>

            <h1>
              <span className="headline-line appear appear--mask" style={{ '--d': '0.42s' } as React.CSSProperties}>
                Record <em>professional videos</em> on
              </span>
              <span className="headline-line appear appear--mask" style={{ '--d': '0.62s' } as React.CSSProperties}>
                your browser in seconds.
              </span>
            </h1>

            <p className="lede appear appear--soft" style={{ '--d': '0.82s', animationDuration: '1.25s' } as React.CSSProperties}>
              A browser-based teleprompter and recording studio that helps you speak naturally, stay on camera, and create better videos.
            </p>

            <div className="hero-actions">
              {session?.user ? (
                <Link
                  href="/studio"
                  className="btn btn-solid hero-btn appear appear--btn hero-solid"
                  style={{ '--d': '0.96s' } as React.CSSProperties}
                >
                  Open Studio
                </Link>
              ) : (
                <button
                  onClick={() => setIsAuthModalOpen(true)}
                  className="btn btn-solid hero-btn appear appear--btn hero-solid"
                  style={{ '--d': '0.96s' } as React.CSSProperties}
                >
                  Start for Free
                </button>
              )}
              <a href="#demo" className="btn btn-ghost hero-btn appear appear--side hero-ghost" style={{ '--d': '1.10s' } as React.CSSProperties}>
                See it in action
              </a>
            </div>
          </div>
        </main>

        <footer className="stats">
          {STATS.map((stat, i) => (
            <div
              key={stat.label}
              className="stat appear appear--stat"
              style={{ '--d': `${1.12 + i * 0.16}s` } as React.CSSProperties}
            >
              {stat.icon}
              <span>{stat.label}</span>
            </div>
          ))}
        </footer>
      </div>

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        callbackUrl="/studio"
      />
    </>
  );
}
