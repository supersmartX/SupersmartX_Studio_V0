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
      <label className="text-sm font-medium text-white">{label}</label>
      <div className="relative">
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-input border-none rounded-xl h-11 px-4 text-white text-sm placeholder:text-white/20 focus:ring-2 focus:ring-white/20 outline-none transition-all"
        />
        {rightElement && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            {rightElement}
          </div>
        )}
      </div>
      {helperText && (
        <p className="text-overline text-white/30">{helperText}</p>
      )}
    </div>
  );
}
