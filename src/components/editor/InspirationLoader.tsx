'use client';

import { INSPIRATION_OPTIONS } from '@/constants';
import { ChevronDownIcon } from '@/components/icons';

interface InspirationLoaderProps {
  onLoad: (key: string) => void;
}

export function InspirationLoader({ onLoad }: InspirationLoaderProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
        Need Inspiration?
      </label>
      <div className="relative">
        <select
          onChange={(e) => {
            if (e.target.value) {
              onLoad(e.target.value);
              e.target.value = '';
            }
          }}
          defaultValue=""
          className="w-full bg-elevated border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-secondary appearance-none cursor-pointer outline-none focus:border-accent transition-colors pr-8"
          suppressHydrationWarning
        >
          <option value="" disabled>
            Load a preset script...
          </option>
          {INSPIRATION_OPTIONS.map((opt) => (
            <option key={opt.key} value={opt.key}>
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
