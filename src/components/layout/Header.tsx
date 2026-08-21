'use client';

import { useState, useRef, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import type { RecordingState } from '@/types';
import { ShareIcon, DownloadIcon, SettingsIcon } from '@/components/icons';

interface HeaderProps {
  recordingState: RecordingState;
  isMobile: boolean;
  hasRecording: boolean;
  onExport: () => void;
  onShare: () => void;
  onToggleInspector?: () => void;
  onSignIn?: () => void;
}

export function Header({
  recordingState: _recordingState,
  isMobile,
  hasRecording,
  onExport,
  onShare,
  onToggleInspector,
  onSignIn,
}: HeaderProps) {
  const { data: session } = useSession();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [imgError, setImgError] = useState(false);
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

  return (
    <header className="h-12 border-b border-border-subtle bg-surface flex items-center px-3 sm:px-4 justify-between shrink-0 z-30 safe-area-top">
      {/* Left: Logo */}
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-6 h-6 flex items-center justify-center shrink-0">
          <img src="/SXS_ICON.png" alt="SupersmartX" className="w-full h-full object-contain" />
        </div>
        <span className="text-[13px] font-bold tracking-wide text-text-primary truncate">
          Supersmart<span className="text-accent">X</span> Studio
        </span>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-1">
        <button
          onClick={onShare}
          aria-label="Share recording"
          className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-md text-[12px] font-medium text-text-secondary hover:text-text-primary hover:bg-elevated transition-colors min-w-[44px] min-h-[44px] justify-center"
        >
          <ShareIcon className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Share</span>
        </button>

        <button
          onClick={onExport}
          disabled={!hasRecording}
          aria-label="Export recording"
          className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-md text-[12px] font-medium text-text-secondary hover:text-text-primary hover:bg-elevated transition-colors disabled:opacity-40 disabled:cursor-not-allowed min-w-[44px] min-h-[44px] justify-center"
        >
          <DownloadIcon className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Export</span>
        </button>

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
                <button
                  role="menuitem"
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
