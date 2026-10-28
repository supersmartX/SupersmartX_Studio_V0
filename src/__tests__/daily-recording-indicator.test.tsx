import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DailyRecordingIndicator } from '@/components/studio/DailyRecordingIndicator';
import { FREE_DAILY_RECORDING_SECONDS } from '@/lib/entitlements';

const TOTAL = FREE_DAILY_RECORDING_SECONDS;

describe('DailyRecordingIndicator', () => {
  describe('Free plan — idle state', () => {
    it('shows 10:00 available for fresh Free user', () => {
      render(<DailyRecordingIndicator remainingSeconds={TOTAL} totalSeconds={TOTAL} />);
      screen.getByText(/Free · 10:00 \/ 10:00 available today/);
    });

    it('shows 06:00 after 4 min used', () => {
      render(<DailyRecordingIndicator remainingSeconds={360} totalSeconds={TOTAL} />);
      screen.getByText(/Free · 06:00 \/ 10:00 available today/);
    });

    it('shows 03:00 after 7 min used', () => {
      render(<DailyRecordingIndicator remainingSeconds={180} totalSeconds={TOTAL} />);
      screen.getByText(/Free · 03:00 \/ 10:00 available today/);
    });

    it('shows 00:00 when fully exhausted', () => {
      render(<DailyRecordingIndicator remainingSeconds={0} totalSeconds={TOTAL} />);
      screen.getByText(/Free · 00:00 \/ 10:00 available today/);
    });
  });

  describe('Creator plan', () => {
    it('shows unlimited recording duration', () => {
      render(<DailyRecordingIndicator remainingSeconds={null} totalSeconds={TOTAL} />);
      screen.getByText(/Creator · Unlimited recording duration/);
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
        'Free recording is limited to up to 10 minutes per browser profile per local calendar day. Device-local limit; may reset if site data is cleared or you switch browser profiles. 06:00 of 10:00 remaining.',
      );
    });

    it('provides meaningful aria-label for recording state', () => {
      render(
        <DailyRecordingIndicator remainingSeconds={180} totalSeconds={TOTAL} isRecording />,
      );
      expect(screen.getByRole('status')).toHaveAttribute(
        'aria-label',
        'Recording: 03:00 remaining today. Device-local limit; may reset if site data is cleared or you switch browser profiles.',
      );
    });

    it('provides meaningful aria-label for Creator', () => {
      render(<DailyRecordingIndicator remainingSeconds={null} totalSeconds={TOTAL} />);
      expect(screen.getByRole('status')).toHaveAttribute(
        'aria-label',
        'Creator plan: unlimited recording duration and sessions',
      );
    });
  });

  describe('Single indicator (UX-010)', () => {
    it('mounts exactly one role="status" node for one budget fact', () => {
      // The transport used to render a `compact` AND a `full` copy and let CSS
      // pick one visually; both stayed in the DOM, so assistive tech read two
      // budget indicators for the same number.
      render(<DailyRecordingIndicator remainingSeconds={360} totalSeconds={TOTAL} />);
      expect(screen.getAllByRole('status')).toHaveLength(1);
    });

    it('carries the device-local fine print as a title rather than body copy', () => {
      render(<DailyRecordingIndicator remainingSeconds={360} totalSeconds={TOTAL} />);
      const el = screen.getByRole('status');
      expect(el.getAttribute('title')).toContain('Device-local limit');
      expect(screen.queryByText(/may reset if site data is cleared/)).toBeNull();
    });

    it('offers a short form for narrow viewports and the long form above sm', () => {
      render(<DailyRecordingIndicator remainingSeconds={360} totalSeconds={TOTAL} />);
      expect(screen.getByText('Free · 06:00')).toHaveClass('sm:hidden');
      expect(screen.getByText('Free · 06:00 / 10:00 available today')).toHaveClass('hidden', 'sm:inline');
    });

    it('short recording form reads the same way', () => {
      render(<DailyRecordingIndicator remainingSeconds={180} totalSeconds={TOTAL} isRecording />);
      expect(screen.getByText('● 03:00 left')).toHaveClass('sm:hidden');
      expect(screen.getByText('● Recording · 03:00 remaining today')).toHaveClass('hidden', 'sm:inline');
    });
  });
});
