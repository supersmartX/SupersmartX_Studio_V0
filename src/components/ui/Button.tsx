import { ButtonHTMLAttributes, forwardRef } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'danger-ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'bg-accent hover:bg-accent-hover text-white shadow-sm shadow-accent/20',
  secondary: 'bg-elevated border border-border-default text-text-primary hover:bg-overlay hover:border-border-strong',
  ghost: 'bg-transparent text-text-secondary hover:text-text-primary hover:bg-elevated',
  destructive: 'bg-error/10 text-error border border-error/20 hover:bg-error/20',
  'danger-ghost': 'bg-transparent text-error hover:bg-error/10',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-10 px-3 text-xs gap-1.5 rounded-md',
  md: 'h-11 px-4 text-sm gap-2 rounded-lg',
  lg: 'h-12 px-5 text-sm gap-2 rounded-lg',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className = '', children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={`
          inline-flex items-center justify-center font-medium
          transition-all duration-150 ease-out
          focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent
          disabled:opacity-40 disabled:pointer-events-none
          active:scale-[0.98]
          ${variantStyles[variant]}
          ${sizeStyles[size]}
          ${className}
        `}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
