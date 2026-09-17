'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { ShareIcon, DownloadIcon, SettingsIcon } from '@/components/icons';
import { isCreatorPlan } from '@/lib/entitlements';

interface HeaderProps {
  isMobile: boolean;
  hasRecording: boolean;
  onExport: () => void;
  onShare: () => void;
  onToggleInspector?: () => void;
  onSignIn?: () => void;
  userPlan?: string;
  onPricingClick?: () => void;
}

export function Header({
  isMobile,
  hasRecording,
  onExport,
  onShare,
  onToggleInspector,
  onSignIn,
  userPlan = 'free',
  onPricingClick,
}: HeaderProps) {
  const { data: session } = useSession();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
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

  const user = session?.user;
  const isCreator = isCreatorPlan(userPlan);

  return (
    <header className="h-12 border-b border-border-subtle bg-surface flex items-center px-3 sm:px-5 justify-between shrink-0 z-30 safe-area-top">
      {/* Left: Logo */}
      <div className="flex items-center min-w-0">
        <Link href="/" className="text-[14px] font-semibold tracking-tight text-text-primary truncate hover:text-text-secondary transition-colors" aria-label="SupersmartX Studio">
          SupersmartX<span className="text-accent font-normal"> Studio</span>
        </Link>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-0.5">
        {hasRecording && (
          <button
            onClick={onShare}
            aria-label="Share recording"
            className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-md text-[12px] font-medium text-text-secondary hover:text-text-primary hover:bg-elevated transition-colors min-w-[44px] min-h-[44px] justify-center"
          >
            <ShareIcon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Share</span>
          </button>
        )}

        {hasRecording && (
          <button
            onClick={onExport}
            title="Export recording"
            aria-label="Export recording"
            className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-md text-[12px] font-medium text-text-secondary hover:text-text-primary hover:bg-elevated transition-colors min-w-[44px] min-h-[44px] justify-center"
          >
            <DownloadIcon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export</span>
          </button>
        )}

        {onToggleInspector && (
          <button
            onClick={onToggleInspector}
            className="p-2 rounded-md text-text-secondary hover:text-text-primary hover:bg-elevated transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Toggle inspector panel"
          >
            <SettingsIcon className="w-4 h-4" />
          </button>
        )}

        {/* User Menu */}
        {user ? (
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              aria-expanded={showUserMenu}
              aria-haspopup="true"
              aria-label="User menu"
              className="w-8 h-8 rounded-full bg-accent/20 text-accent flex items-center justify-center text-[12px] font-bold hover:bg-accent/30 transition-colors overflow-hidden min-w-[44px] min-h-[44px]"
            >
              {user.image && !imgError ? (
                <img src={user.image} alt="" className="w-full h-full object-cover" onError={() => setImgError(true)} />
              ) : (
                (user.name?.[0] || user.email?.[0] || '?').toUpperCase()
              )}
            </button>

            {showUserMenu && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-surface border border-border-default rounded-lg shadow-lg py-1 z-50" role="menu" aria-label="User menu">
                <div className="px-3 py-2 border-b border-border-subtle">
                  <p className="text-[12px] font-medium text-text-primary truncate">{user.name || 'User'}</p>
                  <p className="text-[11px] text-text-muted truncate">{user.email}</p>
                </div>

                <div className="px-3 py-2.5 border-b border-border-subtle flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                      isCreator ? 'bg-accent/20 text-accent' : 'bg-elevated text-text-secondary'
                    }`}>
                      {isCreator ? 'Creator' : 'Free'}
                    </span>
                    <span className="text-[12px] text-text-secondary truncate">
                      {isCreator ? 'Unlimited recording' : '10 min/day recording'}
                    </span>
                  </div>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setShowUserMenu(false);
                      onPricingClick?.();
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-md text-[12px] font-medium bg-accent/15 text-accent hover:bg-accent/25 transition-colors flex items-center gap-2"
                  >
                    {isCreator ? 'Manage Plan' : 'Upgrade to Creator'}
                  </button>
                </div>

                <button
                  role="menuitem"
                  onClick={async () => {
                    setSigningOut(true);
                    await signOut({ callbackUrl: '/' });
                  }}
                  disabled={signingOut}
                  className="w-full text-left px-3 py-2 text-[12px] text-text-secondary hover:bg-elevated transition-colors flex items-center gap-2"
                >
                  {signingOut ? (
                    <>
                      <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                      Signing out...
                    </>
                  ) : (
                    'Sign out'
                  )}
                </button>
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={onSignIn}
            className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-md text-[12px] font-medium text-text-secondary hover:text-text-primary hover:bg-elevated transition-colors min-w-[44px] min-h-[44px] justify-center"
          >
            Log in
          </button>
        )}
      </div>
    </header>
  );
}
