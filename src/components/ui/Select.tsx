'use client';

import { ChevronDownIcon } from '@/components/icons';

interface SelectOption {
  value: string;
  label: string;
  group?: string;
}

interface SelectProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
}

export function Select({ label, value, onChange, options }: SelectProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="text-[13px] text-text-secondary">{label}</label>
      )}
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-elevated border border-border-subtle rounded-lg px-3 py-2 text-[13px] text-text-primary appearance-none cursor-pointer outline-none focus:border-accent transition-colors pr-8"
          suppressHydrationWarning
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <div className="absolute inset-y-0 right-2.5 flex items-center pointer-events-none text-text-muted">
          <ChevronDownIcon className="w-3.5 h-3.5" />
        </div>
      </div>
    </div>
  );
}
