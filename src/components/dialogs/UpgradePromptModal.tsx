'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { detectCountry, getPricingForCountry, formatPrice, type RegionalPricing } from '@/lib/pricing';
import type { PlatformPreset } from '@/types';

interface UpgradePromptModalProps {
  platform: PlatformPreset | null;
  isAuthenticated: boolean;
  onClose: () => void;
  onUpgrade: () => void;
}

// UX-011: every line below is verified against src/lib/entitlements.ts. The
// Free daily-budget line that used to open this list was removed: it described
// what Free does NOT get, inside a list of what Creator DOES get, and made
// Creator read as though it inherited a cap. It matches PRICING_PLANS.creator
// in src/constants/index.ts, which is the canonical customer-facing list.
const CREATOR_BENEFITS = [
  'Unlimited recording duration and sessions',
  'Unlimited teleprompter',
  'Unlimited exports by count & downloads; each file is limited to 2 GiB (about 28 min at current 1080p settings)',
  'All supported platform formats',
  '1080p with no watermark',
  'Voice-activated teleprompter',
  'Cloud video library',
];

export function UpgradePromptModal({ platform, isAuthenticated, onClose, onUpgrade }: UpgradePromptModalProps) {
  const isOpen = platform !== null;
  const [pricing, setPricing] = useState<RegionalPricing | null>(null);
  const [pricingFailed, setPricingFailed] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setPricing(null);
    setPricingFailed(false);
    // detectCountry resolves 'US' on its own geo failures, but this is still an
    // async call across a network boundary — guard it so a rejection can never
    // strand the dialog on a skeleton indefinitely.
    detectCountry()
      .then((country) => setPricing(getPricingForCountry(country)))
      .catch(() => setPricingFailed(true));
  }, [isOpen]);

  if (!platform) return null;

  const monthlyLabel = pricing ? formatPrice(pricing.creatorMonthly, pricing.symbol, pricing.locale) : '';
  const isGuest = !isAuthenticated;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel={`Create for ${platform.label} with Creator`}
      maxWidth="max-w-md"
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center text-[11px] font-bold text-white shrink-0"
            style={{ backgroundColor: platform.color }}
          >
            {platform.icon}
          </div>
          <div className="min-w-0">
            <h3 className="text-[16px] font-semibold text-text-primary leading-tight">
              Create for {platform.label}
            </h3>
            <p className="text-[12px] text-text-secondary mt-0.5">
              {platform.sublabel} with Creator. Free supports YouTube 16:9 only.
            </p>
          </div>
        </div>

        <div className="rounded-xl bg-elevated border border-border-subtle p-4">
          <p className="text-[12px] font-semibold text-text-secondary uppercase tracking-wider mb-2.5">
            Creator unlocks
          </p>
          <ul className="flex flex-col gap-2" role="list">
            {CREATOR_BENEFITS.map((benefit) => (
              <li key={benefit} className="flex items-center gap-2 text-[13px] text-text-primary">
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
                  className="shrink-0"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>{benefit}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* UX-013: this row used to render NOTHING until the geo lookup
            resolved — `{monthlyLabel && ...}` — so the dialog visibly
            collapsed and then re-expanded under the user. A skeleton of
            comparable weight holds the space instead, the real price
            replaces it, and a failed lookup states so rather than
            shimmering forever. min-h matches the resolved line box so the
            swap does not move the button row either. */}
        <div className="flex items-baseline gap-1.5 min-h-[29px]">
          {pricingFailed ? (
            <span className="text-[13px] text-text-secondary">Price unavailable right now</span>
          ) : monthlyLabel ? (
            <span className="text-[20px] font-bold text-text-primary tabular-nums">{monthlyLabel}</span>
          ) : (
            <>
              <span className="sr-only">Loading price</span>
              <span aria-hidden="true" className="inline-block w-20 h-6 rounded bg-elevated animate-pulse" />
            </>
          )}
        </div>
        <p className="text-[11px] text-text-secondary">One-time payment for 1 month of access. No automatic renewal.</p>

        <div className="flex flex-col gap-2">
          {/* UX-012: the purchase action is this dialog's task. Opening a
              purchase prompt and landing on "Close" invites dismissal without
              reading anything. */}
          <Button
            size="md"
            className="w-full"
            data-modal-initial-focus
            onClick={() => {
              onClose();
              onUpgrade();
            }}
          >
            {isGuest ? 'Create account to purchase' : 'Buy Creator access'}
          </Button>
          <Button variant="ghost" size="md" className="w-full" onClick={onClose}>
            {isGuest ? 'Use Free instead' : 'Not now'}
          </Button>
        </div>

        {isGuest && (
          <p className="text-[11px] text-text-muted text-center -mt-1">
            Account required to buy Creator access and download
          </p>
        )}
      </div>
    </Modal>
  );
}
