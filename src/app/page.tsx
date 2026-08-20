'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { AuthModal } from '@/components/auth/AuthModal';

function AnimatedBadge() {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-4 py-1.5 text-sm text-zinc-400 animate-fade-in mb-6">
      <span>Now with AI-powered teleprompter</span>
      <span className="text-amber-400">&#10024;</span>
    </div>
  );
}

function StudioPreview() {
  const sidebarItems = [
    { icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6', label: 'Home', active: true },
    { icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z', label: 'Scripts', badge: '12' },
    { icon: 'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z', label: 'Recordings' },
    { icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10', label: 'Library' },
  ];

  return (
    <div className="mt-8 w-full max-w-5xl animate-fade-in" style={{ animationDelay: '0.5s', animationFillMode: 'both' }}>
      <div
        className="rounded-2xl overflow-hidden p-3 md:p-4"
        style={{
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: '0 25px 80px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05)',
        }}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-[#3B82F6] flex items-center justify-center">
              <span className="text-[10px] font-bold text-white">S</span>
            </div>
            <span className="text-[11px] font-semibold text-white/80">SupersmartX Studio</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] text-[10px] text-white/30">
              Search scripts...
              <span className="px-1.5 py-0.5 rounded bg-white/[0.06] text-[9px]">Ctrl+K</span>
            </div>
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#8B5CF6] flex items-center justify-center">
              <span className="text-[9px] font-bold text-white">JS</span>
            </div>
          </div>
        </div>

        <div className="flex min-h-[320px] md:min-h-[380px]">
          <div className="hidden md:flex flex-col w-44 border-r border-white/[0.06] py-3 px-2">
            <div className="space-y-0.5">
              {sidebarItems.map((item) => (
                <div key={item.label} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] cursor-pointer transition-colors ${item.active ? 'bg-[#3B82F6]/10 text-[#3B82F6]' : 'text-white/40 hover:text-white/60 hover:bg-white/[0.03]'}`}>
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d={item.icon} /></svg>
                  <span className="truncate">{item.label}</span>
                  {item.badge && (
                    <span className="ml-auto px-1.5 py-0.5 rounded-full bg-[#3B82F6]/20 text-[#3B82F6] text-[9px] font-medium">{item.badge}</span>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-4 pt-3 border-t border-white/[0.06]">
              <p className="text-[9px] font-medium text-white/20 uppercase tracking-wider px-2.5 mb-1.5">Settings</p>
              {['Preferences', 'Account'].map((label) => (
                <div key={label} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] text-white/40 hover:text-white/60 hover:bg-white/[0.03] cursor-pointer transition-colors">
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex-1 p-4 md:p-6 space-y-4">
            <div>
              <p className="text-sm font-semibold text-white/80">Welcome back, Jane</p>
              <p className="text-[11px] text-white/30 mt-0.5">Your studio is ready. Pick up where you left off.</p>
            </div>

            <div className="flex flex-wrap gap-2">
              {['New Script', 'Record', 'Import', 'Templates'].map((label, i) => (
                <span key={label} className={`px-3 py-1.5 rounded-full text-[10px] font-medium cursor-pointer transition-all ${i === 0 ? 'bg-[#3B82F6] text-white' : 'bg-white/[0.04] text-white/50 border border-white/[0.06] hover:bg-white/[0.08]'}`}>
                  {label}
                </span>
              ))}
            </div>

            <div className="flex gap-3">
              <div className="flex-1 bg-white/[0.02] border border-white/[0.06] rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[11px] text-white/40">Recent Scripts</p>
                  <span className="text-[9px] text-[#3B82F6]">View all</span>
                </div>
                <div className="space-y-2">
                  {['Product Launch Keynote', 'Weekly Team Update', 'Customer Demo Script'].map((script) => (
                    <div key={script} className="flex items-center gap-2 py-1.5">
                      <div className="w-5 h-5 rounded bg-white/[0.04] flex items-center justify-center">
                        <svg className="w-3 h-3 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      </div>
                      <span className="text-[11px] text-white/60 truncate">{script}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex-1 bg-white/[0.02] border border-white/[0.06] rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[11px] text-white/40">Recordings</p>
                  <span className="text-[9px] text-[#3B82F6]">View all</span>
                </div>
                <div className="space-y-2">
                  {[
                    { name: 'Keynote Final v2', duration: '4:32', status: 'Completed' },
                    { name: 'Team Standup', duration: '2:15', status: 'Completed' },
                    { name: 'Demo Recording', duration: '5:00', status: 'Processing' },
                  ].map((rec) => (
                    <div key={rec.name} className="flex items-center justify-between py-1.5">
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded bg-white/[0.04] flex items-center justify-center">
                          <svg className="w-3 h-3 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        </div>
                        <span className="text-[11px] text-white/60 truncate">{rec.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] text-white/30">{rec.duration}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${rec.status === 'Completed' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>{rec.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const { data: session } = useSession();
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  return (
    <div className="h-screen flex flex-col bg-[#09090B] overflow-hidden selection:bg-white/30">
      {/* Navbar */}
      <nav className="relative z-20 flex items-center justify-between px-6 md:px-12 lg:px-20 py-5">
        <Link href="/" className="flex items-center gap-2.5">
          <img src="/SXS_ICON.png" alt="SuperSmartX" className="w-7 h-7" />
          <span className="text-xl font-semibold tracking-tight text-white">
            SuperSmart<span className="text-[#3B82F6]">X</span>
          </span>
        </Link>

        <div className="hidden md:flex items-center gap-8">
          {['Home', 'Pricing', 'About', 'Contact'].map((link) => (
            <a key={link} href={`#${link.toLowerCase()}`} className="text-sm text-white/40 hover:text-white transition-colors duration-200">
              {link}
            </a>
          ))}
        </div>

        {session?.user ? (
          <Link
            href="/studio"
            className="rounded-full px-5 py-2.5 text-sm font-medium bg-white text-black hover:bg-white/90 transition-all"
          >
            Open Studio
          </Link>
        ) : (
          <button
            onClick={() => setIsAuthModalOpen(true)}
            className="rounded-full px-5 py-2.5 text-sm font-medium bg-white text-black hover:bg-white/90 transition-all"
          >
            Get Started
          </button>
        )}
      </nav>

      {/* Hero */}
      <main className="relative flex-1 flex flex-col items-center w-full">
        <video
          className="absolute inset-0 w-full h-full object-cover z-0"
          autoPlay
          muted
          loop
          playsInline
        >
          <source
            src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260319_015952_e1deeb12-8fb7-4071-a42a-60779fc64ab6.mp4"
            type="video/mp4"
          />
        </video>

        <div className="relative z-10 flex flex-col items-center w-full pt-16 md:pt-20 px-4">
          <AnimatedBadge />

          <h1
            className="text-center text-5xl md:text-6xl lg:text-[5rem] leading-[0.95] tracking-tight text-white max-w-xl animate-fade-in"
            style={{ animationDelay: '0.1s', animationFillMode: 'both' }}
          >
            The Future of <br />
            <span className="italic">Smarter</span> Recording
          </h1>

          <p
            className="mt-4 text-center text-base md:text-lg text-white/50 max-w-[650px] leading-relaxed animate-fade-in"
            style={{ animationDelay: '0.2s', animationFillMode: 'both' }}
          >
            A browser-based teleprompter and recording studio that helps you speak naturally, stay on camera, and create better videos.
          </p>

          <div
            className="mt-5 flex items-center gap-3 animate-fade-in"
            style={{ animationDelay: '0.3s', animationFillMode: 'both' }}
          >
            {session?.user ? (
              <Link
                href="/studio"
                className="rounded-full px-6 py-5 text-sm font-medium bg-white text-black hover:bg-white/90 transition-all"
              >
                Open Studio
              </Link>
            ) : (
              <button
                onClick={() => setIsAuthModalOpen(true)}
                className="rounded-full px-6 py-5 text-sm font-medium bg-white text-black hover:bg-white/90 transition-all"
              >
                Start Recording Free
              </button>
            )}
            <button className="h-11 w-11 rounded-full bg-white/[0.08] border-0 shadow-[0_2px_12px_rgba(0,0,0,0.3)] hover:bg-white/[0.12] transition-all flex items-center justify-center">
              <svg className="w-4 h-4 text-white fill-white" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
            </button>
          </div>

          <StudioPreview />
        </div>
      </main>

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        callbackUrl="/studio"
      />
    </div>
  );
}
