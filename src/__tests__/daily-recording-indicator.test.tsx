import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DailyRecordingIndicator } from '@/components/studio/DailyRecordingIndicator';
import { FREE_DAILY_RECORDING_SECONDS } from '@/lib/entitlements';

const TOTAL = FREE_DAILY_RECORDING_SECONDS;

describe('DailyRecordingIndicator', () => {
  describe('Free plan — idle state', () => {
    it('shows 10:00 available for fresh Free user', () => {
      render(<DailyRecordingIndicator remainingSeconds={TOTAL} totalSeconds={TOTAL} />);
      screen.getByText(/Free · 10:00 \/ 10:00 min available today/);
    });

    it('shows 06:00 after 4 min used', () => {
      render(<DailyRecordingIndicator remainingSeconds={360} totalSeconds={TOTAL} />);
      screen.getByText(/Free · 06:00 \/ 10:00 min available today/);
    });

    it('shows 03:00 after 7 min used', () => {
      render(<DailyRecordingIndicator remainingSeconds={180} totalSeconds={TOTAL} />);
      screen.getByText(/Free · 03:00 \/ 10:00 min available today/);
    });

    it('shows 00:00 when fully exhausted', () => {
      render(<DailyRecordingIndicator remainingSeconds={0} totalSeconds={TOTAL} />);
      screen.getByText(/Free · 00:00 \/ 10:00 min available today/);
    });
  });

  describe('Creator plan', () => {
    it('shows Unlimited recording', () => {
      render(<DailyRecordingIndicator remainingSeconds={null} totalSeconds={TOTAL} />);
      screen.getByText(/Creator · Unlimited recording/);
    });
  });

  describe('Free plan — while recording', () => {
    it('shows recording countdown', () => {
      render(
        <DailyRecordingIndicator
          remainingSeconds={402}
          totalSeconds={TOTAL}
          isRecording
        />,
      );
      screen.getByText(/● Recording · 06:42 remaining today/);
    });

    it('updates when remaining decreases (re-render)', () => {
      const { rerender } = render(
        <DailyRecordingIndicator
          remainingSeconds={360}
          totalSeconds={TOTAL}
          isRecording
        />,
      );
      screen.getByText(/● Recording · 06:00 remaining today/);

      rerender(
        <DailyRecordingIndicator
          remainingSeconds={180}
          totalSeconds={TOTAL}
          isRecording
        />,
      );
      screen.getByText(/● Recording · 03:00 remaining today/);
    });
  });

  describe('In-flight remaining computation + indicator wiring', () => {
    it('accounts for in-flight elapsed time via getDailyRecordingRemainingInFlight', async () => {
      const { getDailyRecordingRemainingInFlight, addDailyRecordingSeconds } = await import('@/lib/daily-recording');
      // Seed through the real write path so the stored day key always matches
      // the implementation's local-day logic regardless of machine timezone
      // (a raw UTC-date string would mismatch on UTC+/-offset day boundaries).
      localStorage.removeItem('sxs-record-day');
      localStorage.removeItem('sxs-record-secs');
      addDailyRecordingSeconds(300);

      const display = getDailyRecordingRemainingInFlight(120);
      expect(display).toBe(180);

      render(<DailyRecordingIndicator remainingSeconds={display} totalSeconds={TOTAL} isRecording />);
      screen.getByText(/● Recording · 03:00 remaining today/);
    });
  });

  describe('Warning states', () => {
    it('applies warning emphasis at ≤2 min remaining', () => {
      const { rerender } = render(
        <DailyRecordingIndicator remainingSeconds={125} totalSeconds={TOTAL} />,
      );
      expect(screen.getByText(/Free · 02:05 \/ 10:00/).className).not.toMatch(/text-warning/);

      rerender(<DailyRecordingIndicator remainingSeconds={120} totalSeconds={TOTAL} />);
      expect(screen.getByText(/Free · 02:00 \/ 10:00/).className).toMatch(/text-warning/);

      rerender(<DailyRecordingIndicator remainingSeconds={0} totalSeconds={TOTAL} />);
      expect(screen.getByText(/Free · 00:00 \/ 10:00/).className).toMatch(/text-warning/);
    });
  });

  describe('Progress bar', () => {
    it('exposes aria-valuenow matching remaining', () => {
      render(<DailyRecordingIndicator remainingSeconds={360} totalSeconds={TOTAL} />);
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '360');
    });

    it('sets aria-valuenow to 0 when exhausted', () => {
      render(<DailyRecordingIndicator remainingSeconds={0} totalSeconds={TOTAL} />);
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    });
  });

  describe('Accessibility', () => {
    it('provides meaningful aria-label for Free idle', () => {
      render(<DailyRecordingIndicator remainingSeconds={360} totalSeconds={TOTAL} />);
      expect(screen.getByRole('status')).toHaveAttribute(
        'aria-label',
        'Free plan: 06:00 of 10:00 recording time available today',
      );
    });

    it('provides meaningful aria-label for recording state', () => {
      render(
        <DailyRecordingIndicator remainingSeconds={180} totalSeconds={TOTAL} isRecording />,
      );
      expect(screen.getByRole('status')).toHaveAttribute(
        'aria-label',
        'Recording: 03:00 remaining today',
      );
    });

    it('provides meaningful aria-label for Creator', () => {
      render(<DailyRecordingIndicator remainingSeconds={null} totalSeconds={TOTAL} />);
      expect(screen.getByRole('status')).toHaveAttribute(
        'aria-label',
        'Creator plan: unlimited recording',
      );
    });
  });

  describe('Compact variant', () => {
    it('renders compact remaining for Free idle', () => {
      render(
        <DailyRecordingIndicator remainingSeconds={360} totalSeconds={TOTAL} variant="compact" />,
      );
      screen.getByText(/Free · 06:00/);
      expect(screen.queryByRole('progressbar')).toBeNull();
    });

    it('renders compact recording countdown', () => {
      render(
        <DailyRecordingIndicator
          remainingSeconds={180}
          totalSeconds={TOTAL}
          isRecording
          variant="compact"
        />,
      );
      screen.getByText(/● 03:00 left/);
    });

    it('renders compact Creator', () => {
      render(
        <DailyRecordingIndicator remainingSeconds={null} totalSeconds={TOTAL} variant="compact" />,
      );
      screen.getByText(/Creator · Unlimited/);
    });
  });
});
