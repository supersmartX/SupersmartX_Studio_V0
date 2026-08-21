'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AuthModal } from '@/components/auth/AuthModal';

const NAV_LINKS = [
  { label: 'Studio', href: '#top' },
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'Pricing', href: '#pricing' },
];

function GrainOverlay() {
  return (
    <div
      className="lsx-grain"
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
    <div className="lsx-hero-photo" style={{ position: 'fixed', inset: 0, zIndex: 0 }}>
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
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.5) 100%)' }} />
    </div>
  );
}

export default function LandingPage() {
  const router = useRouter();
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

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
        const appears = document.querySelectorAll<HTMLElement>('.lsx-appear');
        const heroPhoto = document.querySelector('.lsx-hero-photo');

        appears.forEach((el) => {
          const anims = el.getAnimations();
          if (anims.length === 0) {
            el.classList.add('lsx-is-in');
          } else {
            el.addEventListener('animationend', () => el.classList.add('lsx-is-in'), { once: true });
          }
        });

        if (heroPhoto) {
          const anims = heroPhoto.getAnimations();
          if (anims.length === 0) {
            heroPhoto.classList.add('lsx-is-in');
          } else {
            heroPhoto.addEventListener('animationend', () => heroPhoto.classList.add('lsx-is-in'), { once: true });
          }
        }

        setTimeout(() => {
          appears.forEach((el) => {
            if (!el.classList.contains('lsx-is-in')) el.classList.add('lsx-is-in');
          });
          if (heroPhoto && !heroPhoto.classList.contains('lsx-is-in')) {
            heroPhoto.classList.add('lsx-is-in');
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

.lsx-hero-photo { opacity: 0; transition: opacity 1.05s cubic-bezier(0.16, 1, 0.3, 1); }
.lsx-hero-photo.lsx-is-in { opacity: 1; }

.lsx-page {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-rows: auto 1fr auto;
  min-height: 100vh;
  min-height: 100dvh;
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
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 8px 24px var(--lsx-hero-gap, 85px);
  min-height: 0;
}

.lsx-hero-copy {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  max-width: var(--lsx-copy-max, 860px);
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
  max-width: var(--lsx-lede-max, 470px);
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
  margin-top: 26px;
}

.lsx-menu-backdrop {
  display: block;
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgba(0,0,0,0.80);
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.28s ease, visibility 0.28s ease;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
.lsx-menu-open .lsx-menu-backdrop {
  opacity: 1;
  visibility: visible;
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
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
.lsx-menu-open .lsx-burger-bar:nth-child(1) { transform: translateY(6.5px) rotate(45deg); }
.lsx-menu-open .lsx-burger-bar:nth-child(2) { opacity: 0; }
.lsx-menu-open .lsx-burger-bar:nth-child(3) { transform: translateY(-6.5px) rotate(-45deg); }
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
  .lsx-page { --lsx-logo: 17px; --lsx-nav: 15px; --lsx-nav-h: 44px; --lsx-btn: 15px; --lsx-btn-h: 44px; --lsx-hero-btn-h: 48px; --lsx-h1: 64px; --lsx-lede: 18px; --lsx-badge: 13.5px; --lsx-stat-size: 15px; --lsx-header-y: 28px; --lsx-header-x: 64px; --lsx-stats-x: 96px; --lsx-stats-y: 44px; --lsx-copy-max: 980px; --lsx-lede-max: 540px; }
}
@media (min-width: 1920px) {
  .lsx-page { --lsx-logo: 18px; --lsx-nav: 16px; --lsx-nav-h: 48px; --lsx-btn: 16px; --lsx-btn-h: 48px; --lsx-hero-btn-h: 52px; --lsx-h1: 76px; --lsx-lede: 20px; --lsx-badge: 14.5px; --lsx-stat-size: 16px; --lsx-header-y: 32px; --lsx-header-x: 80px; --lsx-stats-x: 120px; --lsx-stats-y: 52px; --lsx-copy-max: 1120px; --lsx-lede-max: 620px; }
}
@media (min-width: 2560px) {
  .lsx-page { --lsx-h1: 88px; --lsx-lede: 22px; --lsx-header-x: 120px; --lsx-stats-x: 160px; --lsx-copy-max: 1280px; --lsx-lede-max: 680px; }
}
@media (min-width: 901px) and (max-width: 1599px) {
  .lsx-page { --lsx-h1: 54px; --lsx-lede: 16px; --lsx-header-x: 48px; --lsx-stats-x: 80px; --lsx-copy-max: 900px; }
}
@media (min-width: 901px) and (max-width: 1279px) {
  .lsx-page { --lsx-logo: 15px; --lsx-nav: 13px; --lsx-nav-h: 36px; --lsx-btn: 13px; --lsx-btn-h: 38px; --lsx-hero-btn-h: 40px; --lsx-h1: 42px; --lsx-lede: 15px; --lsx-badge: 12px; --lsx-stat-size: 12.5px; --lsx-header-y: 16px; --lsx-header-x: 28px; --lsx-stats-x: 36px; --lsx-stats-y: 28px; --lsx-hero-gap: 64px; --lsx-copy-max: 760px; --lsx-lede-max: 440px; }
}
@media (min-width: 901px) and (max-height: 850px) {
  .lsx-page { --lsx-header-y: 14px; --lsx-stats-y: 24px; --lsx-hero-gap: 48px; --lsx-h1: 40px; }
}
@media (min-width: 901px) and (max-height: 720px) {
  .lsx-page { --lsx-h1: 34px; --lsx-lede: 14px; --lsx-hero-gap: 32px; --lsx-stats-y: 18px; --lsx-nav-h: 30px; --lsx-btn-h: 34px; --lsx-hero-btn-h: 36px; }
}

@media (min-width: 901px) {
  .lsx-page { min-height: 100vh; min-height: 100dvh; }
}

@media (max-width: 900px) {
  .lsx-header { grid-template-columns: 1fr auto; gap: 8px; padding: 16px 18px; }
  .lsx-header-cta-wrap { display: none; }
  .lsx-burger { display: flex; }
  .lsx-site-nav {
    position: fixed; inset: 0; z-index: 45;
    flex-direction: column; background: var(--color-canvas);
    align-items: center; justify-content: center; gap: 12px;
    padding: 96px 22px 32px;
    opacity: 0; visibility: hidden;
    transition: opacity 0.28s ease, visibility 0.28s ease;
  }
  .lsx-menu-open .lsx-site-nav { opacity: 1; visibility: visible; }
  .lsx-site-nav .lsx-nav-pill { width: 100%; height: 56px; font-size: 19px; border-radius: 10px; }
  .lsx-nav-mobile-cta { display: flex; flex-direction: column; gap: 10px; width: 100%; padding-top: 20px; }
  .lsx-nav-mobile-btn { width: 100%; height: 52px; font-size: 16px; }
  .lsx-hero { padding: 20px 20px 64px; align-items: flex-end; }
  .lsx-stats { flex-direction: column; align-items: center; gap: 16px; white-space: normal; padding: 20px 24px 48px; }
  .lsx-page { --lsx-logo: 16px; --lsx-btn: 15px; --lsx-btn-h: 46px; --lsx-hero-btn-h: 48px; --lsx-h1: 36px; --lsx-lede: 16.5px; --lsx-badge: 13.5px; --lsx-header-x: 18px; --lsx-hero-gap: 36px; --lsx-copy-max: 100%; --lsx-lede-max: 100%; }
}

@media (max-width: 560px) {
  .lsx-page { --lsx-h1: 34px; --lsx-lede: 16px; --lsx-header-x: 16px; }
  .lsx-hero-actions { flex-direction: column; width: 100%; }
  .lsx-hero-actions .lsx-btn { width: 100%; }
}

.lsx-footer {
  border-top: 1px solid rgba(255,255,255,0.06);
  padding: 24px var(--lsx-header-x, 40px);
}
.lsx-footer-bottom {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  flex-wrap: wrap;
  font-size: 12px;
  color: rgba(255,255,255,0.3);
}
.lsx-footer-link {
  color: rgba(255,255,255,0.3);
  text-decoration: none;
  transition: color 0.2s ease;
}
.lsx-footer-link:hover {
  color: rgba(255,255,255,0.6);
}
`,
        }}
      />

      <GrainOverlay />
      <HeroVideo />

      <div
        className={`lsx-page${menuOpen ? ' lsx-menu-open' : ''}`}
        ref={pageRef}
      >
        <div className="lsx-menu-backdrop" onClick={closeMenu} />

        <header className="lsx-header">
          <Link href="/" className="lsx-logo lsx-appear" style={{ '--lsx-d': '0.08s' } as React.CSSProperties} aria-label="SupersmartX Studio">
            SUPERSMARTX<span className="text-accent font-normal">Studio</span>
          </Link>

          <nav className="lsx-site-nav" id="lsx-site-nav" aria-label="Primary">
            {NAV_LINKS.map((link, i) => (
              <a
                key={link.label}
                href={link.href}
                className={`lsx-nav-pill lsx-appear ${i % 2 === 0 ? 'lsx-appear--scale' : 'lsx-appear--soft'}`}
                style={{ '--lsx-d': `${0.16 + i * 0.12}s` } as React.CSSProperties}
                onClick={closeMenu}
              >
                {link.label}
              </a>
            ))}
            <div className="lsx-nav-mobile-cta">
              <button
                onClick={() => { setIsAuthModalOpen(true); closeMenu(); }}
                className="lsx-btn lsx-btn-ghost lsx-nav-mobile-btn"
              >
                Log In
              </button>
              <button
                onClick={() => { router.push('/studio'); closeMenu(); }}
                className="lsx-btn lsx-btn-solid lsx-nav-mobile-btn"
              >
                Start Free
              </button>
            </div>
          </nav>

          <div className="lsx-header-cta-wrap">
            <div className="lsx-appear lsx-appear--scale" style={{ '--lsx-d': '0.34s' } as React.CSSProperties}>
              <button
                onClick={() => { setIsAuthModalOpen(true); closeMenu(); }}
                className="lsx-btn lsx-btn-ghost"
                style={{ marginRight: '8px' }}
              >
                Log In
              </button>
              <button
                onClick={() => { router.push('/studio'); closeMenu(); }}
                className="lsx-btn lsx-btn-solid"
              >
                Start Free
              </button>
            </div>
          </div>

          <button
            className="lsx-burger"
            aria-controls="lsx-site-nav"
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
          <div className="lsx-hero-copy">
            <div className="lsx-badge lsx-appear lsx-appear--pop" style={{ '--lsx-d': '0.22s' } as React.CSSProperties}>
              <svg className="lsx-badge-star" width="18" height="20" viewBox="0 0 24 24" fill="white">
                <path d="M12 2.6C12.55 2.6 12.88 3.15 13.08 4.7c.62 4.7 1.52 5.6 6.22 6.22 1.55.2 2.1.53 2.1 1.08s-.55.88-2.1 1.08c-4.7.62-5.6 1.52-6.22 6.22-.2 1.55-.53 2.1-1.08 2.1s-.88-.55-1.08-2.1c-.62-4.7-1.52-5.6-6.22-6.22C3.15 12.88 2.6 12.55 2.6 12s.55-.88 2.1-1.08c4.7-.62 5.6-1.52 6.22-6.22C11.12 3.15 11.45 2.6 12 2.6Z" />
              </svg>
              <span>Browser-based Teleprompter Studio</span>
            </div>

            <h1>
              <span className="lsx-headline-line lsx-appear lsx-appear--mask" style={{ '--lsx-d': '0.42s' } as React.CSSProperties}>
                Record <em>professional videos</em> on
              </span>
              <span className="lsx-headline-line lsx-appear lsx-appear--mask" style={{ '--lsx-d': '0.62s' } as React.CSSProperties}>
                your browser in seconds.
              </span>
            </h1>

            <p className="lsx-lede lsx-appear lsx-appear--soft" style={{ '--lsx-d': '0.82s', animationDuration: '1.25s' } as React.CSSProperties}>
              A browser-based teleprompter and recording studio that helps you speak naturally, stay on camera, and create better videos.
            </p>

            <div className="lsx-hero-actions">
              <button
                onClick={() => router.push('/studio')}
                className="lsx-btn lsx-btn-solid lsx-hero-btn lsx-appear lsx-appear--btn lsx-hero-solid"
                style={{ '--lsx-d': '0.96s' } as React.CSSProperties}
              >
                Start Free
              </button>
              <button
                onClick={() => setIsAuthModalOpen(true)}
                className="lsx-btn lsx-btn-ghost lsx-hero-btn lsx-hero-ghost lsx-appear lsx-appear--btn"
                style={{ '--lsx-d': '1.06s' } as React.CSSProperties}
              >
                Log In
              </button>
            </div>
          </div>
        </main>

        <footer className="lsx-footer">
          <div className="lsx-footer-bottom">
            <span>&copy; {new Date().getFullYear()} SupersmartX. All rights reserved.</span>
            <a href="/legal/terms" className="lsx-footer-link">Terms</a>
            <a href="/legal/privacy" className="lsx-footer-link">Privacy</a>
          </div>
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
