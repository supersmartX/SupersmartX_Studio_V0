import type { ReactNode } from 'react';

interface InputGroupProps {
  label: string;
  placeholder: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  rightElement?: ReactNode;
  helperText?: string;
}

export function InputGroup({ label, placeholder, type = 'text', value, onChange, rightElement, helperText }: InputGroupProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-text-primary">{label}</label>
      <div className="relative">
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-elevated border border-border-subtle rounded-lg h-11 px-4 text-text-primary text-sm placeholder:text-text-muted focus:border-accent outline-none transition-all"
        />
        {rightElement && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            {rightElement}
          </div>
        )}
      </div>
      {helperText && (
        <p className="text-overline text-text-muted">{helperText}</p>
      )}
    </div>
  );
}
