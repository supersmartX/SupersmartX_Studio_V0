interface BrandLogoProps {
  size?: 'sm' | 'md';
}

export function BrandLogo({ size = 'md' }: BrandLogoProps) {
  return (
    <div className="flex items-center gap-2">
      <div className={`${size === 'sm' ? 'w-7 h-7' : 'w-8 h-8'} rounded-full bg-white flex items-center justify-center`}>
        <svg width={size === 'sm' ? 14 : 16} height={size === 'sm' ? 14 : 16} viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
      </div>
      <span className={`${size === 'sm' ? 'text-lg' : 'text-xl'} font-semibold tracking-tight text-white`}>SupersmartX</span>
    </div>
  );
}
