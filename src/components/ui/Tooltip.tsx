'use client';

import { useState, useId, ReactNode, ReactElement, isValidElement, cloneElement } from 'react';

interface TooltipProps {
  content: string;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}

const sideStyles = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
};

export function Tooltip({ content, children, side = 'right' }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const tooltipId = useId();

  const child = isValidElement(children)
    ? cloneElement(children as ReactElement<{ 'aria-describedby'?: string }>, {
        'aria-describedby': [
          (children as ReactElement<{ 'aria-describedby'?: string }>).props['aria-describedby'],
          tooltipId,
        ]
          .filter(Boolean)
          .join(' '),
      })
    : children;

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
      onFocus={() => setIsVisible(true)}
      onBlur={() => setIsVisible(false)}
    >
      {child}
      {isVisible && (
        <div
          id={tooltipId}
          className={`
            absolute z-50 whitespace-nowrap
            bg-overlay text-text-primary text-xs font-medium
            px-2 py-1 rounded-md
            shadow-lg border border-border-subtle
            pointer-events-none
            animate-fade-in
            ${sideStyles[side]}
          `}
          role="tooltip"
        >
          {content}
        </div>
      )}
    </div>
  );
}
