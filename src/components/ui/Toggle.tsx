'use client';

import { useId } from 'react';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, description, disabled = false }: ToggleProps) {
  const labelId = useId();

  return (
    <div className="flex items-center justify-between min-h-[44px] py-1">
      {(label || description) && (
        <div className="flex flex-col gap-0.5">
          {label && (
            <span id={labelId} className="text-[13px] text-text-primary">{label}</span>
          )}
          {description && (
            <span className="text-xs text-text-muted">{description}</span>
          )}
        </div>
      )}
      <button
        role="switch"
        aria-checked={checked}
        aria-labelledby={label ? labelId : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`
          relative inline-flex h-[26px] w-[46px] shrink-0 rounded-full
          transition-colors duration-200 ease-out
          focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent
          disabled:opacity-40 disabled:cursor-not-allowed
          ${checked ? 'bg-accent' : 'bg-border-strong'}
        `}
        suppressHydrationWarning
      >
        <span
          className={`
            pointer-events-none inline-block h-[22px] w-[22px] rounded-full
            bg-white shadow-sm
            transition-transform duration-200 ease-out
            translate-y-[2px]
            ${checked ? 'translate-x-[22px]' : 'translate-x-[2px]'}
          `}
        />
      </button>
    </div>
  );
}
