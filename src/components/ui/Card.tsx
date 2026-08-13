'use client';

import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className = '' }: CardProps) {
  return (
    <div className={`rounded-2xl border border-border-subtle bg-surface p-4 shadow-sm ${className}`}>
      {children}
    </div>
  );
}
