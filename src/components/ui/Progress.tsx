interface ProgressProps {
  value: number;
  max?: number;
  size?: 'sm' | 'md';
  className?: string;
}

export function Progress({ value, max = 100, size = 'sm', className = '' }: ProgressProps) {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);

  return (
    <div
      className={`
        w-full bg-border-default rounded-full overflow-hidden
        ${size === 'sm' ? 'h-1' : 'h-1.5'}
        ${className}
      `}
    >
      <div
        className="h-full bg-accent rounded-full transition-all duration-300 ease-out"
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}
