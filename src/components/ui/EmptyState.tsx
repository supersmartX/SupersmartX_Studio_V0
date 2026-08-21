import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  badge?: string;
}

export function EmptyState({ icon, title, description, badge = 'Coming Soon' }: EmptyStateProps) {
  return (
    <div className="flex items-center justify-center p-8 md:p-12 min-h-[60vh]">
      <div className="max-w-md w-full">
        <div className="bg-surface border border-border-default rounded-xl p-8 flex flex-col items-center text-center relative overflow-hidden">
          <div className="absolute -top-16 -left-16 w-40 h-40 bg-accent/5 rounded-full blur-3xl" />

          <div className="w-14 h-14 rounded-xl bg-accent/10 flex items-center justify-center mb-5 border border-accent/15">
            {icon}
          </div>

          <h3 className="text-base font-semibold text-text-primary mb-2">
            {title}
          </h3>
          <p className="text-body-sm text-text-secondary max-w-sm leading-relaxed mb-6">
            {description}
          </p>

          {badge && (
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-accent" />
              </span>
              {badge}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
