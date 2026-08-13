import { InputHTMLAttributes, forwardRef } from 'react';

interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  showValue?: boolean;
}

export const Slider = forwardRef<HTMLInputElement, SliderProps>(
  ({ label, value, min, max, step = 1, unit = '', showValue = true, className = '', ...props }, ref) => {
    return (
      <div className={`flex flex-col gap-1.5 ${className}`}>
        {(label || showValue) && (
          <div className="flex justify-between items-center">
            {label && (
              <label className="text-[13px] text-text-secondary">{label}</label>
            )}
            {showValue && (
              <span className="text-xs font-mono text-accent tabular-nums">
                {step < 1 ? value.toFixed(1) : value}{unit}
              </span>
            )}
          </div>
        )}
        <input
          ref={ref}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          {...props}
        />
      </div>
    );
  }
);

Slider.displayName = 'Slider';
