'use client';

interface CountdownOverlayProps {
  countdownText: string;
  isVisible: boolean;
}

export function CountdownOverlay({ countdownText, isVisible }: CountdownOverlayProps) {
  return (
    <div
      className={`absolute inset-0 z-50 flex items-center justify-center bg-canvas/80 backdrop-blur-sm transition-opacity duration-200 ${
        isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      <span
        key={countdownText}
        className="text-7xl font-bold text-accent drop-shadow-[0_0_40px_rgba(59,130,246,0.5)] animate-countdown"
      >
        {countdownText}
      </span>
    </div>
  );
}
