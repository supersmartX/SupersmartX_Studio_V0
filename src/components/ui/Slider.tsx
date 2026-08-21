import { InputHTMLAttributes, forwardRef, useId } from 'react';

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
    const id = useId();
    const valueId = useId();

    return (
      <div className={`flex flex-col gap-1.5 ${className}`}>
        {(label || showValue) && (
          <div className="flex justify-between items-center">
            {label && (
              <label htmlFor={id} className="text-[13px] text-text-secondary">{label}</label>
            )}
            {showValue && (
              <span id={valueId} className="text-xs font-mono text-accent tabular-nums">
                {step < 1 ? value.toFixed(1) : value}{unit}
              </span>
            )}
          </div>
        )}
        <input
          ref={ref}
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={label ? `${step < 1 ? value.toFixed(1) : value}${unit} ${label}` : undefined}
          aria-describedby={showValue ? valueId : undefined}
          {...props}
        />
      </div>
    );
  }
);

Slider.displayName = 'Slider';
