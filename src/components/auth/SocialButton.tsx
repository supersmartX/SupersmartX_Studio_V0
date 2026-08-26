import type { ReactNode, ButtonHTMLAttributes } from 'react';

interface SocialButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
}

export function SocialButton({ icon, label, ...props }: SocialButtonProps) {
  return (
    <button
      {...props}
      className="flex items-center justify-center gap-2.5 py-3 bg-surface border border-border-subtle rounded-lg hover:bg-elevated transition-all text-sm font-medium text-text-primary disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px]"
    >
      {icon}
      {label}
    </button>
  );
}
