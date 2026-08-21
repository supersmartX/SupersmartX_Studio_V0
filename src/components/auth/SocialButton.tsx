import type { ReactNode, ButtonHTMLAttributes } from 'react';

interface SocialButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
}

export function SocialButton({ icon, label, ...props }: SocialButtonProps) {
  return (
    <button
      {...props}
      className="flex items-center justify-center gap-2.5 py-3 bg-surface border border-white/10 rounded-xl hover:bg-white/5 transition-all text-sm font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {icon}
      {label}
    </button>
  );
}
