'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { AuthModal } from '@/components/auth/AuthModal';

export default function LandingPage() {
  const { data: session } = useSession();
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="min-h-screen bg-[#09090B] text-white selection:bg-accent/30">
      {/* ═══════════ HEADER ═══════════ */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06] bg-[#09090B]/70 backdrop-blur-2xl">
        <div className="max-w-[1200px] mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <img src="/SXS_ICON.png" alt="SuperSmartX" className="w-7 h-7" />
            <span className="text-[15px] font-bold tracking-tight">
              SuperSmart<span className="text-[#3B82F6]">X</span>
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-8">
            <Link href="#features" className="text-[13px] text-zinc-400 hover:text-white transition-colors duration-200">
              Features
            </Link>
            <Link href="#how-it-works" className="text-[13px] text-zinc-400 hover:text-white transition-colors duration-200">
              How It Works
            </Link>
            <Link href="/studio?support=1" className="text-[13px] text-zinc-400 hover:text-white transition-colors duration-200">
              Support
            </Link>
          </nav>

          <div className="flex items-center gap-3">
            {session?.user ? (
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="w-8 h-8 rounded-full bg-accent/20 text-accent flex items-center justify-center text-[12px] font-bold hover:bg-accent/30 transition-colors overflow-hidden"
                >
                  {session.user.image ? (
                    <img src={session.user.image} alt="" className="w-full h-full object-cover" />
                  ) : (
                    (session.user.name?.[0] || session.user.email?.[0] || '?').toUpperCase()
                  )}
                </button>

                {showUserMenu && (
                  <div className="absolute right-0 top-full mt-1 w-48 bg-surface border border-border-default rounded-lg shadow-lg py-1 z-50">
                    <div className="px-3 py-2 border-b border-border-subtle">
                      <p className="text-[12px] font-medium text-text-primary truncate">{session.user.name || 'User'}</p>
                      <p className="text-[11px] text-text-muted truncate">{session.user.email}</p>
                    </div>
                    <Link href="/studio" className="block w-full text-left px-3 py-2 text-[12px] text-text-secondary hover:bg-elevated transition-colors">
                      Open Studio
                    </Link>
                    <button
                      onClick={() => { signOut({ callbackUrl: '/' }); setShowUserMenu(false); }}
                      className="w-full text-left px-3 py-2 text-[12px] text-text-secondary hover:bg-elevated transition-colors"
                    >
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={() => setIsAuthModalOpen(true)}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-zinc-400 hover:text-white rounded-lg hover:bg-white/5 transition-all duration-200"
              >
                Sign In
              </button>
            )}
            <Link
              href="/studio"
              className="flex items-center gap-1.5 px-4 py-2 bg-[#3B82F6] hover:bg-[#2563EB] text-white text-[13px] font-semibold rounded-lg transition-all duration-200 shadow-lg shadow-[#3B82F6]/20"
            >
              Try Studio Free
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
            </Link>
          </div>
        </div>
      </header>

      {/* ═══════════ HERO ═══════════ */}
      <section className="relative pt-32 pb-20 overflow-hidden">
        {/* Background glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-[#3B82F6]/[0.08] rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute top-20 right-0 w-[400px] h-[400px] bg-[#3B82F6]/[0.05] rounded-full blur-[100px] pointer-events-none" />

        <div className="max-w-[1200px] mx-auto px-6 relative">
          <div className="text-center max-w-[800px] mx-auto mb-16">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/[0.03] border border-white/[0.08] mb-8">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span className="text-[12px] font-medium text-zinc-300 tracking-wide">Early access &mdash; 2026</span>
            </div>

            {/* Headline */}
            <h1 className="text-[clamp(2.5rem,6vw,4.5rem)] font-bold tracking-tight leading-[1.05] mb-6">
              Record naturally.<br />
              <span className="bg-gradient-to-r from-[#3B82F6] via-[#60A5FA] to-[#93C5FD] bg-clip-text text-transparent">
                Create confidently.
              </span>
            </h1>

            {/* Subheadline */}
            <p className="text-[17px] sm:text-[19px] text-zinc-400 max-w-[600px] mx-auto leading-relaxed mb-10">
              A browser-based teleprompter and recording studio that helps you speak naturally, stay on camera, and create better videos.
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
              <Link
                href="/studio"
                className="group flex items-center gap-2 px-7 py-3.5 bg-[#3B82F6] hover:bg-[#2563EB] text-white rounded-xl font-semibold text-[15px] transition-all duration-200 shadow-xl shadow-[#3B82F6]/25 hover:shadow-[#3B82F6]/40 hover:-translate-y-0.5"
              >
                Try Studio Free
                <svg className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
              </Link>
              <a href="#product" className="flex items-center gap-2 px-7 py-3.5 bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 rounded-xl font-medium text-[15px] transition-all duration-200 border border-white/[0.08] hover:border-white/[0.12]">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                Watch Demo
              </a>
            </div>

            {/* Trust badges */}
            <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[13px] text-zinc-500">
              {['No sign-up required', 'Camera + teleprompter', 'Record locally'].map((item) => (
                <span key={item} className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-emerald-500/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  {item}
                </span>
              ))}
            </div>
          </div>

          {/* ═══════════ PRODUCT PREVIEW ═══════════ */}
          <div className="relative max-w-[1100px] mx-auto" id="product">
            {/* Glow behind */}
            <div className="absolute -inset-8 bg-gradient-to-b from-[#3B82F6]/[0.12] via-[#3B82F6]/[0.04] to-transparent rounded-3xl blur-2xl pointer-events-none" />

            <div className="relative rounded-2xl border border-white/[0.08] bg-[#111113] overflow-hidden shadow-2xl shadow-black/50">
              {/* Browser bar */}
              <div className="flex items-center gap-3 px-4 py-3 bg-[#18181B] border-b border-white/[0.06]">
                <div className="flex gap-2">
                  <div className="w-3 h-3 rounded-full bg-[#FF5F57]/80" />
                  <div className="w-3 h-3 rounded-full bg-[#FFBD2E]/80" />
                  <div className="w-3 h-3 rounded-full bg-[#28CA42]/80" />
                </div>
                <div className="flex-1 mx-6">
                  <div className="flex items-center gap-2 bg-[#09090B] rounded-lg px-3 py-1.5 max-w-md mx-auto">
                    <svg className="w-3.5 h-3.5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" /></svg>
                    <span className="text-[12px] text-zinc-500">supersmartx.com/studio</span>
                  </div>
                </div>
                <div className="w-16" />
              </div>

              {/* Screenshot */}
              <div className="relative bg-[#09090B]">
                <img
                  src="/screenshort.png"
                  alt="SuperSmartX Studio — Teleprompter and Recording Interface"
                  className="w-full h-auto block"
                />

                {/* Labels */}
                <div className="absolute top-4 left-4 sm:top-6 sm:left-6">
                  <span className="px-2.5 py-1 rounded-lg bg-[#111113]/80 backdrop-blur-sm border border-white/[0.06] text-[10px] font-medium text-zinc-400 uppercase tracking-wider">Teleprompter</span>
                </div>
                <div className="absolute top-1/2 -translate-y-1/2 left-4 sm:left-6">
                  <span className="px-2.5 py-1 rounded-lg bg-[#3B82F6]/10 backdrop-blur-sm border border-[#3B82F6]/20 text-[10px] font-medium text-[#60A5FA] uppercase tracking-wider">Eye-line</span>
                </div>
                <div className="absolute bottom-4 right-4 sm:bottom-6 sm:right-6">
                  <span className="px-2.5 py-1 rounded-lg bg-[#111113]/80 backdrop-blur-sm border border-white/[0.06] text-[10px] font-medium text-zinc-400 uppercase tracking-wider">Camera</span>
                </div>
                <div className="absolute bottom-4 left-4 sm:bottom-6 sm:left-6">
                  <span className="px-2.5 py-1 rounded-lg bg-[#111113]/80 backdrop-blur-sm border border-white/[0.06] text-[10px] font-medium text-zinc-500 uppercase tracking-wider">Studio Controls</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════ PROBLEM SECTION ═══════════ */}
      <section className="relative py-24 border-t border-white/[0.04]">
        <div className="absolute inset-0 bg-gradient-to-b from-[#3B82F6]/[0.04] to-transparent pointer-events-none" />
        <div className="max-w-[700px] mx-auto px-6 text-center relative">
          <h2 className="text-[clamp(1.75rem,4vw,2.75rem)] font-bold tracking-tight mb-5">
            Stop memorizing. Start speaking.
          </h2>
          <p className="text-[16px] sm:text-[18px] text-zinc-400 leading-relaxed mb-6">
            SuperSmartX keeps your script close to the camera line so creators can speak naturally while recording.
          </p>
          <Link
            href="/studio"
            className="inline-flex items-center gap-2 px-6 py-3 bg-[#3B82F6] hover:bg-[#2563EB] text-white rounded-xl font-semibold text-[14px] transition-all duration-200 shadow-lg shadow-[#3B82F6]/20"
          >
            Try Studio Free
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
          </Link>
        </div>
      </section>

      {/* ═══════════ FEATURES ═══════════ */}
      <section id="features" className="py-24 border-t border-white/[0.04]">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-[clamp(1.75rem,4vw,2.75rem)] font-bold tracking-tight mb-4">
              Built for creators
            </h2>
            <p className="text-[16px] text-zinc-400 max-w-[500px] mx-auto">
              Everything you need to record professional videos, right in your browser.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            {[
              {
                num: '01',
                title: 'Smart Teleprompter',
                desc: 'Keep your script close to your camera line and speak naturally.',
                items: ['Auto-scroll', 'WPM control', 'Eye-line guidance', 'Script editor', 'Focus View'],
                icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>,
              },
              {
                num: '02',
                title: 'Professional Recording',
                desc: 'Record directly from your browser with studio-quality controls.',
                items: ['Camera', 'Microphone', 'Countdown', 'Pause / Resume', 'Recording timer'],
                icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" /></svg>,
              },
              {
                num: '03',
                title: 'Instant Preview',
                desc: 'Review your recording with full playback controls before you download.',
                items: ['Video playback', 'Audio playback', 'Seek', 'Speed control', 'Fullscreen'],
                icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15.91 11.672a.375.375 0 010 .656l-5.603 3.113a.375.375 0 01-.557-.328V8.887c0-.286.307-.466.557-.327l5.603 3.112z" /></svg>,
              },
              {
                num: '04',
                title: 'Share & Export',
                desc: 'Take your finished recording wherever you need it.',
                items: ['Download', 'Web Share', 'Clipboard fallback', 'Record again'],
                icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>,
              },
            ].map((f) => (
              <div key={f.num} className="group relative bg-[#111113] border border-white/[0.06] rounded-2xl p-7 hover:border-[#3B82F6]/20 transition-all duration-300">
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-b from-[#3B82F6]/[0.03] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                <div className="relative">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-[#3B82F6]/10 border border-[#3B82F6]/20 flex items-center justify-center text-[#60A5FA]">
                      {f.icon}
                    </div>
                    <div>
                      <span className="text-[11px] font-mono text-[#3B82F6]/60 block mb-0.5">{f.num}</span>
                      <h3 className="text-[16px] font-semibold">{f.title}</h3>
                    </div>
                  </div>
                  <p className="text-[14px] text-zinc-400 mb-5 leading-relaxed">{f.desc}</p>
                  <div className="flex flex-wrap gap-2">
                    {f.items.map((item) => (
                      <span key={item} className="px-2.5 py-1 rounded-lg bg-white/[0.03] border border-white/[0.06] text-[11px] text-zinc-400 font-medium">
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════ HOW IT WORKS ═══════════ */}
      <section id="how-it-works" className="py-24 border-t border-white/[0.04]">
        <div className="max-w-[900px] mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-[clamp(1.75rem,4vw,2.75rem)] font-bold tracking-tight mb-4">
              How it works
            </h2>
            <p className="text-[16px] text-zinc-400">Six steps from script to finished video.</p>
          </div>

          <div className="relative">
            {/* Connection line */}
            <div className="absolute top-8 left-[calc(50%-0.5px)] w-px h-[calc(100%-64px)] bg-gradient-to-b from-[#3B82F6]/20 via-[#3B82F6]/10 to-transparent hidden sm:block" />

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-8 sm:gap-6">
              {[
                'Write or paste your script',
                'Position the teleprompter',
                'Press Record',
                'Speak naturally',
                'Preview your recording',
                'Download or share',
              ].map((step, i) => (
                <div key={i} className="text-center relative">
                  <div className="relative z-10 w-16 h-16 rounded-2xl bg-[#111113] border border-white/[0.08] flex items-center justify-center mx-auto mb-4 group-hover:border-[#3B82F6]/20 transition-colors">
                    <span className="text-[18px] font-bold font-mono text-[#3B82F6]/70">{String(i + 1).padStart(2, '0')}</span>
                  </div>
                  <p className="text-[14px] text-zinc-300 font-medium">{step}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="text-center mt-14">
            <Link
              href="/studio"
              className="inline-flex items-center gap-2 px-6 py-3 bg-[#3B82F6] hover:bg-[#2563EB] text-white rounded-xl font-semibold text-[14px] transition-all duration-200 shadow-lg shadow-[#3B82F6]/20 hover:shadow-[#3B82F6]/30"
            >
              Try Studio Free
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
            </Link>
          </div>
        </div>
      </section>

      {/* ═══════════ GUEST-FIRST ═══════════ */}
      <section className="py-24 border-t border-white/[0.04] bg-gradient-to-b from-[#3B82F6]/[0.02] to-transparent">
        <div className="max-w-[900px] mx-auto px-6">
          <div className="text-center mb-14">
            <h2 className="text-[clamp(1.75rem,4vw,2.75rem)] font-bold tracking-tight mb-5">
              Try it before you sign up.
            </h2>
            <p className="text-[16px] sm:text-[18px] text-zinc-400 max-w-[600px] mx-auto leading-relaxed">
              Open the Studio, write your script, record your video, and preview it without creating an account.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-12">
            {[
              { icon: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" /></svg>, label: 'Camera' },
              { icon: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>, label: 'Teleprompter' },
              { icon: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>, label: 'Recording' },
              { icon: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15.91 11.672a.375.375 0 010 .656l-5.603 3.113a.375.375 0 01-.557-.328V8.887c0-.286.307-.466.557-.327l5.603 3.112z" /></svg>, label: 'Preview' },
            ].map((item) => (
              <div key={item.label} className="bg-[#111113] border border-white/[0.06] rounded-2xl p-6 text-center hover:border-[#3B82F6]/20 transition-colors group">
                <div className="w-12 h-12 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mx-auto mb-3 text-zinc-400 group-hover:text-[#60A5FA] group-hover:bg-[#3B82F6]/10 group-hover:border-[#3B82F6]/20 transition-all">
                  {item.icon}
                </div>
                <span className="text-[13px] text-zinc-300 font-medium">{item.label}</span>
              </div>
            ))}
          </div>

          <div className="text-center">
            <p className="text-[14px] text-zinc-500 mb-8">
              Sign-in is only requested when you&apos;re ready to download your recording.
            </p>
            <Link
              href="/studio"
              className="inline-flex items-center gap-2 px-6 py-3 bg-[#3B82F6] hover:bg-[#2563EB] text-white rounded-xl font-semibold text-[14px] transition-all duration-200 shadow-lg shadow-[#3B82F6]/20"
            >
              Open Studio
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
            </Link>
          </div>
        </div>
      </section>

      {/* ═══════════ PRIVACY ═══════════ */}
      <section id="privacy" className="py-24 border-t border-white/[0.04]">
        <div className="max-w-[900px] mx-auto px-6">
          <div className="text-center mb-14">
            <h2 className="text-[clamp(1.75rem,4vw,2.75rem)] font-bold tracking-tight mb-4">
              Your studio. Your recording. Your device.
            </h2>
            <p className="text-[16px] text-zinc-400 max-w-[600px] mx-auto leading-relaxed">
              SuperSmartX keeps your recording workflow privacy-first by recording locally in the browser and preserving your script on your device.
            </p>
          </div>

          <div className="grid sm:grid-cols-3 gap-5">
            {[
              { title: 'Browser-based', desc: 'Recording happens entirely in your browser. No app install required.', icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" /></svg> },
              { title: 'Local storage', desc: 'Scripts persist in your browser via localStorage. Never sent to our servers.', icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" /></svg> },
              { title: 'No auto-upload', desc: 'Opening Studio never uploads your content. You stay in control.', icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" /></svg> },
            ].map((item) => (
              <div key={item.title} className="bg-[#111113] border border-white/[0.06] rounded-2xl p-6 hover:border-white/[0.1] transition-colors">
                <div className="w-10 h-10 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center text-zinc-400 mb-4">
                  {item.icon}
                </div>
                <h3 className="text-[15px] font-semibold mb-2">{item.title}</h3>
                <p className="text-[13px] text-zinc-500 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════ FEEDBACK + SUPPORT ═══════════ */}
      <section className="py-20 border-t border-white/[0.04] bg-gradient-to-b from-transparent to-[#3B82F6]/[0.02]">
        <div className="max-w-[700px] mx-auto px-6">
          <div className="grid sm:grid-cols-2 gap-8">
            {/* Feedback */}
            <div className="text-center sm:text-left">
              <h3 className="text-[18px] font-bold mb-2">Help shape SuperSmartX.</h3>
              <p className="text-[14px] text-zinc-400 mb-5">
                Found something that could be better? Tell us what you think.
              </p>
              <a
                href="https://discord.gg/supersmartx"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 rounded-xl font-medium text-[13px] transition-all duration-200 border border-white/[0.08]"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.67 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.094 13.094 0 01-1.873-.894.077.077 0 01-.008-.128c.126-.093.252-.19.372-.287a.075.075 0 01.077-.011c3.92 1.793 8.18 1.793 12.061 0a.073.073 0 01.078.009c.12.099.246.195.373.289a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.894.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.156-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.156 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.156-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.156 2.418z" /></svg>
                Send Feedback
              </a>
            </div>

            {/* Support */}
            <div className="text-center sm:text-left">
              <h3 className="text-[18px] font-bold mb-2">
                <span className="mr-2">&#9749;</span>Enjoying SuperSmartX?
              </h3>
              <p className="text-[14px] text-zinc-400 mb-5">
                Your support helps us keep building and improving the Studio.
              </p>
              <Link
                href="/studio?support=1"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#FFDD00] hover:bg-[#FFEA4D] text-slate-900 rounded-xl font-semibold text-[13px] transition-all duration-200"
              >
                Support SuperSmartX
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════ TERMS SECTION ═══════════ */}
      <section id="terms" className="py-14 border-t border-white/[0.04] bg-[#09090B]">
        <div className="max-w-[900px] mx-auto px-6 text-center">
          <h2 className="text-[clamp(1.5rem,4vw,2.25rem)] font-bold tracking-tight mb-4">
            Terms & privacy-first recording
          </h2>
          <p className="text-[15px] text-zinc-400 max-w-[700px] mx-auto leading-relaxed">
            SuperSmartX runs in your browser, and recordings only leave your device when you choose to export or share them. No sign-in is required to use the Studio, only when you want to download your work.
          </p>
        </div>
      </section>

      {/* ═══════════ FINAL CTA ═══════════ */}
      <section className="py-28 border-t border-white/[0.04]">
        <div className="max-w-[600px] mx-auto px-6 text-center">
          <h2 className="text-[clamp(1.75rem,4vw,2.75rem)] font-bold tracking-tight mb-4">
            Ready to try the Studio?
          </h2>
          <p className="text-[16px] text-zinc-400 mb-10">
            Open SuperSmartX Studio and record your first video.
          </p>
          <Link
            href="/studio"
            className="inline-flex items-center gap-2 px-8 py-4 bg-[#3B82F6] hover:bg-[#2563EB] text-white rounded-xl font-semibold text-[15px] transition-all duration-200 shadow-xl shadow-[#3B82F6]/25 hover:shadow-[#3B82F6]/40 hover:-translate-y-0.5"
          >
            Try Studio Free
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
          </Link>
          <p className="text-[12px] text-zinc-600 mt-5">
            No sign-up required to start.
          </p>
        </div>
      </section>

      {/* ═══════════ FOOTER ═══════════ */}
      <footer className="border-t border-white/[0.06] bg-[#09090B]">
        <div className="max-w-[1200px] mx-auto px-6 py-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2.5">
              <img src="/SXS_ICON.png" alt="" className="w-5 h-5" />
              <span className="text-[14px] font-bold">
                SuperSmart<span className="text-[#3B82F6]">X</span>
              </span>
              <span className="text-[11px] text-zinc-600">Private Beta &bull; 2026</span>
            </div>

              <div className="flex items-center gap-7 flex-wrap justify-center">
              <Link href="#product" className="text-[12px] text-zinc-500 hover:text-zinc-300 transition-colors">
                Product
              </Link>
              <Link href="#features" className="text-[12px] text-zinc-500 hover:text-zinc-300 transition-colors">
                Features
              </Link>
              <Link href="/studio?support=1" className="text-[12px] text-zinc-500 hover:text-zinc-300 transition-colors">
                Support
              </Link>
              <Link href="#privacy" className="text-[12px] text-zinc-500 hover:text-zinc-300 transition-colors">
                Privacy
              </Link>
              <Link href="#terms" className="text-[12px] text-zinc-500 hover:text-zinc-300 transition-colors">
                Terms
              </Link>
              <button onClick={() => setIsAuthModalOpen(true)} className="text-[12px] text-zinc-500 hover:text-zinc-300 transition-colors">
                Sign In
              </button>
            </div>
          </div>
        </div>
      </footer>

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        callbackUrl="/studio"
        onSuccess={() => window.location.href = '/studio'}
      />
    </div>
  );
}
