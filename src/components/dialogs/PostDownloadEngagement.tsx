'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from '@/components/ui/Modal';
import { DiscordIcon, CrownIcon, ArrowRightIcon } from '@/components/icons';
import { DISCORD_COMMUNITY_URL } from '@/constants';

interface PostDownloadEngagementProps {
  isOpen: boolean;
  onClose: () => void;
  /** Paid plans see their own tools instead of an upgrade ask. */
  isCreator: boolean;
  /** The existing pricing/upgrade flow (never a new checkout path). */
  onExploreCreator: () => void;
  onOpenLibrary?: () => void;
  onShare?: () => void;
}

/**
 * Shown once a download has actually started, never before: the file is
 * already on its way when this appears, so nothing here can gate it.
 */
export function PostDownloadEngagement({
  isOpen,
  onClose,
  isCreator,
  onExploreCreator,
  onOpenLibrary,
  onShare,
}: PostDownloadEngagementProps) {
  const creatorAction = onOpenLibrary ?? onShare;

  // Rendered into <body> rather than inside the export sheet: the sheet is its
  // own `aria-modal` dialog and an `isolate` stacking context, so a nested copy
  // would be announced as a dialog inside a dialog and its backdrop could
  // composite against the sheet instead of the page.
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => setPortalReady(true), []);

  const dialog = (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Keep creating with SupersmartX"
      maxWidth="max-w-md"
      zIndexClassName="z-onboard"
    >
      <div className="flex flex-col gap-3">
        {/* A missing invite must never become a dead link, so the card simply
            does not render rather than offering a button that goes nowhere. */}
        {DISCORD_COMMUNITY_URL && (
          <section className="rounded-xl border border-border-subtle bg-elevated p-4 shadow-lg">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-discord/15">
                <DiscordIcon className="h-4 w-4 text-discord" />
              </span>
              <div className="min-w-0">
                <h3 className="text-[13px] font-semibold text-text-primary">Join our Discord community</h3>
                <p className="mt-1 text-[12px] leading-relaxed text-text-secondary">
                  Connect with other creators, share feedback and get product updates.
                </p>
                <a
                  href={DISCORD_COMMUNITY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-modal-initial-focus
                  className="mt-2 inline-flex min-h-[36px] items-center gap-1.5 rounded-md text-[12px] font-semibold text-discord transition-colors hover:text-discord-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Join Discord
                  <ArrowRightIcon className="h-3.5 w-3.5" />
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </div>
            </div>
          </section>
        )}

        {isCreator ? (
          <section className="rounded-xl border border-border-subtle bg-elevated p-4 shadow-lg">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15">
                <CrownIcon className="h-4 w-4 text-accent-text" />
              </span>
              <div className="min-w-0">
                <h3 className="text-[13px] font-semibold text-text-primary">Your Creator Pro tools are unlocked</h3>
                <p className="mt-1 text-[12px] leading-relaxed text-text-secondary">
                  Unlimited recording, every platform format, 1080p with no watermark and a Cloud Library.
                </p>
                {creatorAction && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      creatorAction();
                    }}
                    className="mt-2 inline-flex min-h-[36px] items-center gap-1.5 rounded-md text-[12px] font-semibold text-accent-text transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {onOpenLibrary ? 'Open My Library' : 'Share Studio Link'}
                    <ArrowRightIcon className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          </section>
        ) : (
          <section className="rounded-xl border border-border-subtle bg-elevated p-4 shadow-lg">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15">
                <CrownIcon className="h-4 w-4 text-accent-text" />
              </span>
              <div className="min-w-0">
                <h3 className="text-[13px] font-semibold text-text-primary">Upgrade to Creator Pro</h3>
                <p className="mt-1 text-[12px] leading-relaxed text-text-secondary">
                  Unlimited recording, every platform format, 1080p with no watermark and a Cloud Library.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onExploreCreator();
                  }}
                  className="mt-2 inline-flex min-h-[36px] items-center gap-1.5 rounded-md text-[12px] font-semibold text-accent-text transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Explore Creator Pro
                  <ArrowRightIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </section>
        )}
      </div>
    </Modal>
  );

  if (!portalReady) return null;
  return createPortal(dialog, document.body);
}
