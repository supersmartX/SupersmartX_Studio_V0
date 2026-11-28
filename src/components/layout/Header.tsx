'use client';

import { useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { ShareIcon, DownloadIcon, SettingsIcon } from '@/components/icons';
import { isCreatorPlan } from '@/lib/entitlements';
import { useDismissOnOutsideClick } from '@/hooks/useDismissOnOutsideClick';
import { useAccountBilling } from '@/hooks/useAccountBilling';
import { formatBillingDate } from '@/lib/billing/humanize';

interface HeaderProps {
  hasRecording: boolean;
  onExport: () => void;
  onShare: () => void;
  onToggleInspector?: () => void;
  /** Wired to the inspector toggle so AT can announce open/closed state. */
  isInspectorOpen?: boolean;
  onSignIn?: () => void;
  userPlan?: string;
  onPricingClick?: () => void;
  /**
   * Slot for the compact-layout navigation (the hamburger). Rendered at the
   * far left of the app bar so it reads as the primary menu, and empty on
   * desktop where the side rail already provides those destinations.
   */
  compactNav?: React.ReactNode;
}

export function Header({
  hasRecording,
  onExport,
  onShare,
  onToggleInspector,
  isInspectorOpen,
  onSignIn,
  userPlan = 'free',
  onPricingClick,
  compactNav,
}: HeaderProps) {
  const { data: session } = useSession();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeUserMenu = useCallback(() => setShowUserMenu(false), []);
  // Outside-click AND Escape both dismiss the menu (keyboard users were
  // previously trapped: Escape did nothing).
  useDismissOnOutsideClick(menuRef, showUserMenu, closeUserMenu);

  const user = session?.user;
  const isCreator = isCreatorPlan(userPlan);
  const signedIn = Boolean(user);

  // Billing status is read from the server when the menu opens: the session's
  // plan is enough to know whether access is active, but not when it ends, and
  // an expired plan is indistinguishable from never having bought one without
  // the stored date. The fetch + cancellation mutation live in the shared
  // useAccountBilling hook (the /settings page offers the identical flow).
  const { stats: billing, paddle: paddleBilling, cancelRequested, cancelNotice, cancelAtPeriodEnd } =
    useAccountBilling({ enabled: showUserMenu && signedIn });

  const accessUntil =
    billing?.planActive && billing.planExpiresAt
      ? formatBillingDate(billing.planExpiresAt)
      : null;
  const expiredOn =
    billing && !billing.planActive && billing.planExpiresAt
      ? formatBillingDate(billing.planExpiresAt)
      : null;

  return (
    <header className="h-12 border-b border-border-subtle bg-surface flex items-center px-3 sm:px-5 justify-between shrink-0 z-30">
      {/* Left: menu (compact) + Logo */}
      <div className="flex items-center min-w-0">
        {compactNav}
        <Link href="/" className="py-2.5 text-[14px] font-semibold tracking-tight text-text-primary truncate hover:text-text-secondary transition-colors" aria-label="SupersmartX Studio">
          SupersmartX
          {/* Phones run out of room once Share/Export/Inspector appear, and the
              brand ellipsised to "SupersmartX S…". Drop the qualifier there —
              the app bar is already inside the Studio — so the name stays whole.
              The link keeps the full accessible name. */}
          <span className="hidden sm:inline text-accent-text font-normal"> Studio</span>
        </Link>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-0.5">
        {hasRecording && (
          <button
            onClick={onShare}
            // The share control shares the STUDIO link (navigator.share /
            // clipboard of window.location.href) — not a media file, so the
            // name says what it actually does.
            aria-label="Share Studio link"
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
            aria-label={hasRecording ? 'Export settings' : 'Toggle inspector panel'}
            title={hasRecording ? 'Export settings' : 'Studio settings'}
            aria-haspopup={hasRecording ? 'dialog' : undefined}
            aria-expanded={isInspectorOpen}
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
              <div className="absolute right-0 top-full mt-1 w-64 bg-surface border border-border-default rounded-lg shadow-lg py-1 z-50" role="menu" aria-label="User menu">
                <div className="px-3 py-2 border-b border-border-subtle">
                  <p className="text-[12px] font-medium text-text-primary truncate">{user.name || 'User'}</p>
                  <p className="text-[11px] text-text-muted truncate">{user.email}</p>
                </div>

                <div className="px-3 py-2.5 border-b border-border-subtle flex flex-col gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Plan & billing</p>
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                      isCreator ? 'bg-accent/20 text-accent' : 'bg-elevated text-text-secondary'
                    }`}>
                      {isCreator ? 'Creator' : 'Free'}
                    </span>
                    <span
                      className="text-[12px] text-text-secondary truncate"
                      title={isCreator ? 'Unlimited recording duration and sessions' : 'Free recording is limited to up to 10 minutes per browser profile per local calendar day. This device-local limit may reset if site data is cleared or you switch browser profiles.'}
                    >
                      {isCreator ? 'Unlimited recording duration' : 'Up to 10 min/day per browser profile'}
                    </span>
                  </div>
                  {accessUntil && (
                    <p className="text-[11px] text-text-muted">Access until {accessUntil}</p>
                  )}
                  {expiredOn && (
                    <p className="text-[11px] text-text-muted">Creator term ended {expiredOn}</p>
                  )}
                  {paddleBilling?.account?.nextChargeAt && (
                    <p className="text-[11px] text-text-muted">Next charge {formatBillingDate(paddleBilling.account.nextChargeAt)}</p>
                  )}
                  {paddleBilling?.account?.cancellationConfirmed && (
                    <p className="text-[11px] text-accent">Cancellation scheduled</p>
                  )}
                  {paddleBilling?.account?.cancelAtPeriodEnd && !paddleBilling?.account?.cancellationConfirmed && (
                    <p className="text-[11px] text-text-muted">Cancellation pending confirmation...</p>
                  )}
                  {paddleBilling?.account && ['past_due', 'payment_failed'].includes(paddleBilling.account.status) && (
                    <p role="status" className="text-[11px] text-warning">Your latest payment needs attention.</p>
                  )}
                  {paddleBilling?.account?.paymentMethodUpdateUrl && (
                    <a
                      role="menuitem"
                      href={paddleBilling.account.paymentMethodUpdateUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-full px-2.5 py-1.5 rounded-md text-[12px] font-medium text-accent-text hover:bg-elevated"
                    >
                      Retry payment or update payment method
                    </a>
                  )}
                  <Link
                    href="/settings"
                    role="menuitem"
                    onClick={() => setShowUserMenu(false)}
                    className="block w-full rounded-md px-2.5 py-1.5 text-[12px] text-text-secondary hover:bg-elevated hover:text-text-primary"
                  >
                    Account settings
                  </Link>
                  <Link
                    href="/billing"
                    role="menuitem"
                    onClick={() => setShowUserMenu(false)}
                    className="block w-full rounded-md px-2.5 py-1.5 text-[12px] text-text-secondary hover:bg-elevated hover:text-text-primary"
                  >
                    Billing history
                  </Link>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setShowUserMenu(false);
                      onPricingClick?.();
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-md text-[12px] font-medium bg-accent/15 text-accent hover:bg-accent/25 transition-colors flex items-center gap-2"
                  >
                    {isCreator
                      ? 'Manage or extend plan'
                      : expiredOn
                        ? 'Renew Creator'
                        : 'Upgrade to Creator'}
                  </button>
                  {paddleBilling?.account &&
                    isCreator &&
                    paddleBilling.account.status === 'active' &&
                    Boolean(paddleBilling.account.paidThroughAt && new Date(paddleBilling.account.paidThroughAt).getTime() > Date.now()) &&
                    !paddleBilling.account.cancellationConfirmed && (
                    <button
                      role="menuitem"
                      disabled={cancelRequested}
                      onClick={cancelAtPeriodEnd}
                      className="w-full text-left px-2.5 py-1.5 rounded-md text-[12px] font-medium text-text-secondary hover:bg-elevated"
                    >
                      {cancelRequested ? 'Cancellation awaiting confirmation...' : paddleBilling.account.cancelAtPeriodEnd ? 'Check cancellation status' : 'Cancel at period end'}
                    </button>
                  )}
                  {cancelNotice && (
                    <p role="status" aria-live="polite" className="px-2.5 py-1.5 text-[11px] text-text-muted">
                      {cancelNotice}
                    </p>
                  )}
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
            className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-md text-[12px] font-medium text-text-secondary hover:text-text-primary hover:bg-elevated transition-colors min-w-[44px] min-h-[44px] justify-center whitespace-nowrap"
          >
            Log in
          </button>
        )}
      </div>
    </header>
  );
}
