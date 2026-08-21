interface StepItemProps {
  number: number;
  text: string;
  active?: boolean;
}

export function StepItem({ number, text, active = false }: StepItemProps) {
  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${active ? 'bg-white text-black' : 'bg-input text-white'}`}>
      <span className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold shrink-0 ${active ? 'bg-black text-white' : 'bg-white/10 text-white/40'}`}>
        {number}
      </span>
      <span className="text-sm font-medium">{text}</span>
    </div>
  );
}
