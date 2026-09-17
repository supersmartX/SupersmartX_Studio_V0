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

const CREATOR_BENEFITS = [
  'Everything in Free',
  'Unlimited recording',
  'Unlimited teleprompter',
  'Unlimited exports & downloads',
  'All supported platform formats',
  '1080p with no watermark',
  'Voice-activated teleprompter',
  'Cloud video library',
];

export function UpgradePromptModal({ platform, isAuthenticated, onClose, onUpgrade }: UpgradePromptModalProps) {
  const isOpen = platform !== null;
  const [pricing, setPricing] = useState<RegionalPricing | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setPricing(null);
    detectCountry().then((country) => setPricing(getPricingForCountry(country)));
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

        <div className="flex items-baseline gap-1.5">
          {monthlyLabel && (
            <span className="text-[20px] font-bold text-text-primary tabular-nums">{monthlyLabel}</span>
          )}
          <span className="text-[12px] text-text-secondary">/month</span>
        </div>

        <div className="flex flex-col gap-2">
          <Button
            size="md"
            className="w-full"
            onClick={() => {
              onClose();
              onUpgrade();
            }}
          >
            {isGuest ? 'Continue' : 'Upgrade to Creator'}
          </Button>
          <Button variant="ghost" size="md" className="w-full" onClick={onClose}>
            {isGuest ? 'Use Free instead' : 'Not now'}
          </Button>
        </div>

        {isGuest && (
          <p className="text-[11px] text-text-muted text-center -mt-1">
            Account required to subscribe and download
          </p>
        )}
      </div>
    </Modal>
  );
}
