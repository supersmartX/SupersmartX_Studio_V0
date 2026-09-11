interface FocalGuidewayProps {
  position: number;
}

export function FocalGuideway({ position }: FocalGuidewayProps) {
  return (
    <div
      className="absolute left-0 right-0 h-px flex items-center justify-center pointer-events-none z-20 group/guideway"
      style={{ top: `${position}%` }}
      aria-hidden="true"
    >
      <div className="absolute inset-0 h-px bg-gradient-to-r from-transparent via-accent/30 to-transparent" />
      <div className="relative bg-accent/90 backdrop-blur-sm px-2 py-0.5 rounded text-[10px] font-bold tracking-wide text-white border border-accent/50 shadow-[0_0_12px_rgba(124,58,237,0.25)] uppercase opacity-50 group-hover/guideway:opacity-100 transition-opacity">
        Natural Eye Line
      </div>
      <div className="absolute top-full mt-1 bg-surface border border-border-default rounded-lg px-3 py-2 text-[11px] text-text-secondary shadow-lg opacity-0 group-hover/guideway:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
        Position your script here for natural eye contact with the camera
      </div>
    </div>
  );
}
