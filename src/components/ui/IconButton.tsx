import { ButtonHTMLAttributes, forwardRef, ReactNode } from 'react';

type IconButtonSize = 'sm' | 'md' | 'lg';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: IconButtonSize;
  tooltip?: string;
  isActive?: boolean;
  children: ReactNode;
}

const sizeStyles: Record<IconButtonSize, string> = {
  sm: 'w-10 h-10 rounded-md',
  md: 'w-11 h-11 rounded-lg',
  lg: 'w-12 h-12 rounded-lg',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ size = 'md', tooltip, isActive = false, className = '', children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        aria-label={tooltip}
        className={`
          inline-flex items-center justify-center
          transition-all duration-150 ease-out
          focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent
          disabled:opacity-40 disabled:pointer-events-none
          active:scale-95
          ${isActive
            ? 'bg-accent/15 text-accent'
            : 'bg-transparent text-text-secondary hover:text-text-primary hover:bg-elevated'
          }
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

IconButton.displayName = 'IconButton';
