import { BarChartIcon } from '@/components/icons';
import { EmptyState } from '@/components/ui/EmptyState';

export function InsightsPlaceholder() {
  return (
    <EmptyState
      icon={<BarChartIcon className="w-7 h-7 text-accent" />}
      title="Session Insights"
      description="Real-time analytics with AI-driven feedback on voice pacing, structural pauses, tone modulation, and eye contact consistency."
    />
  );
}
