import type { ReactNode } from 'react';

interface InputGroupProps {
  label: string;
  placeholder: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  rightElement?: ReactNode;
  helperText?: string;
  /**
   * UX-012: the sign-in step's email input already receives focus on open, but
   * the register step focused nothing — so the dialog opened with focus on
   * nothing (or on the header Close, which is first in the DOM). Opting the
   * first field of the active step keeps the initial focus on the task.
   * Only one field per dialog should ever set this.
   */
  autoFocus?: boolean;
}

export function InputGroup({ label, placeholder, type = 'text', value, onChange, rightElement, helperText, autoFocus = false }: InputGroupProps) {
  const inputId = `input-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-text-primary">{label}</label>
      <div className="relative">
        <input
          id={inputId}
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus={autoFocus}
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
