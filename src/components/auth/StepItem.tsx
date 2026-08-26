interface StepItemProps {
  number: number;
  text: string;
  active?: boolean;
}

export function StepItem({ number, text, active = false }: StepItemProps) {
  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${active ? 'bg-accent text-white' : 'bg-elevated text-text-secondary'}`}>
      <span className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold shrink-0 ${active ? 'bg-white text-accent' : 'bg-border-subtle text-text-muted'}`}>
        {number}
      </span>
      <span className="text-sm font-medium">{text}</span>
    </div>
  );
}
