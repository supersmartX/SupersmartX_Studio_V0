interface FocalGuidewayProps {
  position: number;
}

export function FocalGuideway({ position }: FocalGuidewayProps) {
  return (
    <div
      className="absolute left-0 right-0 h-px flex items-center justify-center pointer-events-none z-[60]"
      style={{ top: `${position}%` }}
    >
      <div className="absolute inset-0 h-px bg-gradient-to-r from-transparent via-accent/30 to-transparent" />
      <div className="relative bg-accent/90 backdrop-blur-sm px-2 py-0.5 rounded text-[9px] font-bold tracking-wide text-white border border-accent/50 shadow-[0_0_12px_rgba(59,130,246,0.25)] uppercase">
        Natural Eye Line
      </div>
    </div>
  );
}
