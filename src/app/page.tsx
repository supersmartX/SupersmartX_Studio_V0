'use client';

import { useState, useEffect, useCallback } from 'react';
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
        zIndex: 5,
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
        preload="auto"
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
    const raf = requestAnimationFrame(() => {
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
    return () => cancelAnimationFrame(raf);
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
  padding: 8px 24px var(--lsx-hero-gap, 64px);
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
  .lsx-site-nav { display: none; }
  .lsx-hero { padding: 20px 20px 64px; align-items: flex-end; }
  .lsx-stats { flex-direction: column; align-items: center; gap: 16px; white-space: normal; padding: 20px 24px 48px; }
  .lsx-page { --lsx-logo: 16px; --lsx-btn: 15px; --lsx-btn-h: 46px; --lsx-hero-btn-h: 48px; --lsx-h1: 36px; --lsx-lede: 16.5px; --lsx-badge: 13.5px; --lsx-header-x: 18px; --lsx-hero-gap: 36px; --lsx-copy-max: 100%; --lsx-lede-max: 100%; }
}

@media (max-width: 560px) {
  .lsx-page { --lsx-h1: 34px; --lsx-lede: 16px; --lsx-header-x: 16px; }
  .lsx-hero-actions { flex-direction: column; width: 100%; }
  .lsx-hero-actions .lsx-btn { width: 100%; }
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
  padding: 96px 24px;
  border-top: 1px solid rgba(255,255,255,0.06);
}
.lsx-section-inner {
  max-width: 960px;
  margin: 0 auto;
}
.lsx-section-header {
  text-align: center;
  margin-bottom: 64px;
}
.lsx-section-label {
  display: inline-block;
  padding: 6px 14px;
  border-radius: 5px;
  border: 1px solid rgba(124,58,237,0.25);
  background: rgba(124,58,237,0.08);
  color: var(--color-accent-hover);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  margin-bottom: 20px;
}
.lsx-section-title {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  font-size: 36px;
  font-weight: 500;
  letter-spacing: -0.03em;
  line-height: 1.15;
  color: #fff;
  margin-bottom: 14px;
}
.lsx-section-subtitle {
  color: rgba(255,255,255,0.45);
  font-size: 16px;
  line-height: 1.6;
  max-width: 480px;
  margin: 0 auto;
}

.lsx-steps {
  display: flex;
  align-items: flex-start;
  gap: 0;
}
.lsx-step {
  flex: 1;
  text-align: center;
  padding: 0 24px;
  position: relative;
}
.lsx-step-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(124,58,237,0.12);
  border: 1px solid rgba(124,58,237,0.25);
  color: var(--color-accent-hover);
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 20px;
}
.lsx-step-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  color: var(--color-accent-hover);
  margin-bottom: 20px;
}
.lsx-step-title {
  font-size: 17px;
  font-weight: 500;
  color: #fff;
  letter-spacing: -0.02em;
  margin-bottom: 10px;
}
.lsx-step-desc {
  font-size: 14px;
  line-height: 1.65;
  color: rgba(255,255,255,0.4);
  max-width: 260px;
  margin: 0 auto;
}
.lsx-step-connector {
  width: 60px;
  height: 1px;
  background: rgba(255,255,255,0.08);
  margin-top: 48px;
  flex-shrink: 0;
}

.lsx-pricing-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
  max-width: 960px;
  margin: 0 auto;
}
.lsx-pricing-card {
  position: relative;
  padding: 36px 32px;
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.02);
  transition: border-color 0.25s ease, background 0.25s ease;
}
.lsx-pricing-card:hover {
  border-color: rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.03);
}
.lsx-pricing-card--pro {
  border-color: rgba(124,58,237,0.3);
  background: rgba(124,58,237,0.04);
}
.lsx-pricing-card--pro:hover {
  border-color: rgba(124,58,237,0.45);
  background: rgba(124,58,237,0.06);
}
.lsx-pricing-badge {
  position: absolute;
  top: -11px;
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 14px;
  border-radius: 20px;
  background: var(--color-accent);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.03em;
  white-space: nowrap;
}
.lsx-pricing-card-header {
  margin-bottom: 28px;
  padding-bottom: 24px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.lsx-pricing-plan {
  font-size: 16px;
  font-weight: 500;
  color: rgba(255,255,255,0.6);
  margin-bottom: 8px;
}
.lsx-pricing-price {
  font-size: 40px;
  font-weight: 500;
  letter-spacing: -0.03em;
  color: #fff;
  line-height: 1;
}
.lsx-pricing-period {
  font-size: 16px;
  font-weight: 400;
  color: rgba(255,255,255,0.35);
}
.lsx-pricing-note {
  font-size: 12px;
  color: rgba(255,255,255,0.3);
  margin-top: 6px;
}
.lsx-pricing-features {
  list-style: none;
  padding: 0;
  margin: 0 0 28px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.lsx-pricing-feature {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  color: rgba(255,255,255,0.5);
  line-height: 1.4;
}
.lsx-pricing-feature svg {
  flex-shrink: 0;
}
.lsx-pricing-feature--highlight {
  color: rgba(255,255,255,0.8);
}
.lsx-pricing-btn {
  width: 100%;
  height: 48px;
  font-size: 14px;
}

@media (max-width: 700px) {
  .lsx-section { padding: 64px 20px; }
  .lsx-section-title { font-size: 28px; }
  .lsx-section-subtitle { font-size: 15px; }
  .lsx-steps { flex-direction: column; align-items: center; gap: 0; }
  .lsx-step { padding: 0; max-width: 320px; }
  .lsx-step-connector { width: 1px; height: 40px; margin: 0; }
  .lsx-pricing-grid { grid-template-columns: 1fr; max-width: 400px; }
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
        className="lsx-page"
      >
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
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="lsx-header-cta-wrap">
            <div className="lsx-appear lsx-appear--scale" style={{ '--lsx-d': '0.34s' } as React.CSSProperties}>
              <button
                type="button"
                onClick={() => setIsAuthModalOpen(true)}
                className="lsx-btn lsx-btn-ghost"
                style={{ marginRight: '8px' }}
              >
                Log In
              </button>
              <button
                type="button"
                onClick={() => router.push('/studio')}
                className="lsx-btn lsx-btn-solid"
              >
                Start Free
              </button>
            </div>
          </div>

          <button
            type="button"
            className={`lsx-burger${menuOpen ? ' is-open' : ''}`}
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
          <div className="lsx-hero-copy">
            <div className="lsx-badge lsx-appear lsx-appear--pop" style={{ '--lsx-d': '0.22s' } as React.CSSProperties}>
              <svg className="lsx-badge-star" width="18" height="20" viewBox="0 0 24 24" fill="white" aria-hidden="true">
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
                type="button"
                onClick={() => router.push('/studio')}
                className="lsx-btn lsx-btn-solid lsx-hero-btn lsx-appear lsx-appear--btn lsx-hero-solid"
                style={{ '--lsx-d': '0.96s' } as React.CSSProperties}
              >
                Start Free
              </button>
              <button
                type="button"
                onClick={() => setIsAuthModalOpen(true)}
                className="lsx-btn lsx-btn-ghost lsx-hero-btn lsx-hero-ghost lsx-appear lsx-appear--btn"
                style={{ '--lsx-d': '1.06s' } as React.CSSProperties}
              >
                Log In
              </button>
            </div>
          </div>
        </main>

        <section className="lsx-section lsx-how" id="how-it-works">
          <div className="lsx-section-inner">
            <div className="lsx-section-header">
              <span className="lsx-section-label">How It Works</span>
              <h2 className="lsx-section-title">Three steps to better videos</h2>
              <p className="lsx-section-subtitle">No downloads. No complicated software. Just open your browser and start recording.</p>
            </div>
            <div className="lsx-steps">
              <div className="lsx-step">
                <div className="lsx-step-number">1</div>
                <div className="lsx-step-icon">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                    <path d="m15 5 4 4"/>
                  </svg>
                </div>
                <h3 className="lsx-step-title">Write your script</h3>
                <p className="lsx-step-desc">Type, paste, or generate a script with AI. Our built-in teleprompter scrolls at your pace so you never lose your place.</p>
              </div>
              <div className="lsx-step-connector" />
              <div className="lsx-step">
                <div className="lsx-step-number">2</div>
                <div className="lsx-step-icon">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/>
                    <circle cx="12" cy="13" r="3"/>
                  </svg>
                </div>
                <h3 className="lsx-step-title">Record yourself</h3>
                <p className="lsx-step-desc">Use your webcam with a real-time teleprompter overlay. Pause, resume, and re-record until it feels right.</p>
              </div>
              <div className="lsx-step-connector" />
              <div className="lsx-step">
                <div className="lsx-step-number">3</div>
                <div className="lsx-step-icon">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                </div>
                <h3 className="lsx-step-title">Export &amp; share</h3>
                <p className="lsx-step-desc">Download your video in high quality. Share directly to YouTube, LinkedIn, or any platform.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="lsx-section lsx-pricing" id="pricing">
          <div className="lsx-section-inner">
            <div className="lsx-section-header">
              <span className="lsx-section-label">Pricing</span>
              <h2 className="lsx-section-title">Start free. Upgrade when ready.</h2>
              <p className="lsx-section-subtitle">PPP-adjusted pricing available in 60+ countries.</p>
            </div>
            <div className="lsx-pricing-grid">
              <div className="lsx-pricing-card">
                <div className="lsx-pricing-card-header">
                  <h3 className="lsx-pricing-plan">Free</h3>
                  <div className="lsx-pricing-price">$0<span className="lsx-pricing-period">/forever</span></div>
                </div>
                <ul className="lsx-pricing-features">
                  <li className="lsx-pricing-feature">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                    Teleprompter (always free)
                  </li>
                  <li className="lsx-pricing-feature">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                    Audio recording &amp; download
                  </li>
                  <li className="lsx-pricing-feature">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                    3 video downloads free
                  </li>
                  <li className="lsx-pricing-feature">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                    Videos up to 5 min duration
                  </li>
                </ul>
                <button
                  type="button"
                  onClick={() => router.push('/studio')}
                  className="lsx-btn lsx-btn-ghost lsx-pricing-btn"
                >
                  Get Started
                </button>
              </div>
              <div className="lsx-pricing-card lsx-pricing-card--pro">
                <div className="lsx-pricing-badge">Save 17%</div>
                <div className="lsx-pricing-card-header">
                  <h3 className="lsx-pricing-plan">Pro Yearly</h3>
                  <div className="lsx-pricing-price">$49.99<span className="lsx-pricing-period">/year</span></div>
                  <p className="lsx-pricing-note">That&apos;s $4.17/month</p>
                </div>
                <ul className="lsx-pricing-features">
                  <li className="lsx-pricing-feature">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                    Everything in Free
                  </li>
                  <li className="lsx-pricing-feature lsx-pricing-feature--highlight">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                    Unlimited video downloads
                  </li>
                  <li className="lsx-pricing-feature lsx-pricing-feature--highlight">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                    Unlimited recording length
                  </li>
                  <li className="lsx-pricing-feature lsx-pricing-feature--highlight">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                    4K export quality
                  </li>
                  <li className="lsx-pricing-feature">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                    Priority support
                  </li>
                  <li className="lsx-pricing-feature">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                    Custom branding
                  </li>
                  <li className="lsx-pricing-feature">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                    Cloud sync
                  </li>
                </ul>
                <button
                  type="button"
                  onClick={() => setIsAuthModalOpen(true)}
                  className="lsx-btn lsx-btn-solid lsx-pricing-btn"
                >
                  Get Pro Yearly
                </button>
              </div>
              <div className="lsx-pricing-card lsx-pricing-card--pro">
                <div className="lsx-pricing-badge">Popular</div>
                <div className="lsx-pricing-card-header">
                  <h3 className="lsx-pricing-plan">Pro</h3>
                  <div className="lsx-pricing-price">$4.99<span className="lsx-pricing-period">/month</span></div>
                  <p className="lsx-pricing-note">PPP-adjusted by region</p>
                </div>
                <ul className="lsx-pricing-features">
                  <li className="lsx-pricing-feature">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                    Everything in Free
                  </li>
                  <li className="lsx-pricing-feature lsx-pricing-feature--highlight">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                    Unlimited video downloads
                  </li>
                  <li className="lsx-pricing-feature lsx-pricing-feature--highlight">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                    Unlimited recording length
                  </li>
                  <li className="lsx-pricing-feature lsx-pricing-feature--highlight">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                    4K export quality
                  </li>
                  <li className="lsx-pricing-feature">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                    Priority support
                  </li>
                  <li className="lsx-pricing-feature">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                    Custom branding
                  </li>
                  <li className="lsx-pricing-feature">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                    Cloud sync
                  </li>
                </ul>
                <button
                  type="button"
                  onClick={() => setIsAuthModalOpen(true)}
                  className="lsx-btn lsx-btn-solid lsx-pricing-btn"
                >
                  Get Pro
                </button>
              </div>
            </div>
          </div>
        </section>

        <footer className="lsx-footer">
          <div className="lsx-footer-bottom">
            <span>&copy; {new Date().getFullYear()} SupersmartX. All rights reserved.</span>
            <Link href="/legal/terms" className="lsx-footer-link">Terms</Link>
            <Link href="/legal/privacy" className="lsx-footer-link">Privacy</Link>
          </div>
        </footer>
      </div>

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        callbackUrl="/studio"
      />

      {menuOpen && (
        <div
          id="lsx-mobile-nav"
          className="lsx-mobile-nav-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
        >
          <div
            className="lsx-mobile-nav-backdrop"
            onClick={closeMenu}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') closeMenu(); }}
            role="button"
            tabIndex={0}
            aria-label="Close menu"
          />
          <div className="lsx-mobile-nav-content">
              <button
                type="button"
                className="lsx-mobile-nav-close"
                onClick={closeMenu}
                aria-label="Close menu"
              >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <nav className="lsx-mobile-nav-links" aria-label="Mobile navigation">
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
                onClick={() => { setIsAuthModalOpen(true); closeMenu(); }}
                className="lsx-btn lsx-btn-ghost lsx-mobile-nav-btn"
              >
                Log In
              </button>
              <button
                type="button"
                onClick={() => { router.push('/studio'); closeMenu(); }}
                className="lsx-btn lsx-btn-solid lsx-mobile-nav-btn"
              >
                Start Free
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
