import { BarChartIcon } from '@/components/icons';

export function InsightsPlaceholder() {
  return (
    <div className="flex items-center justify-center p-8 md:p-12 min-h-[60vh]">
      <div className="max-w-md w-full">
        <div className="bg-surface border border-border-default rounded-xl p-8 flex flex-col items-center text-center relative overflow-hidden">
          <div className="absolute -top-16 -left-16 w-40 h-40 bg-accent/5 rounded-full blur-3xl" />

          <div className="w-14 h-14 rounded-xl bg-accent/10 flex items-center justify-center mb-5 border border-accent/15">
            <BarChartIcon className="w-7 h-7 text-accent" />
          </div>

          <h3 className="text-base font-semibold text-text-primary mb-2">
            Session Insights
          </h3>
          <p className="text-[13px] text-text-secondary max-w-sm leading-relaxed mb-6">
            Real-time analytics with AI-driven feedback on voice pacing,
            structural pauses, tone modulation, and eye contact consistency.
          </p>

          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-accent" />
            </span>
            Coming Soon
          </div>
        </div>
      </div>
    </div>
  );
}
