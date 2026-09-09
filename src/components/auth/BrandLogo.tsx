import Image from 'next/image';

interface BrandLogoProps {
  size?: 'sm' | 'md';
}

export function BrandLogo({ size = 'md' }: BrandLogoProps) {
  const px = size === 'sm' ? 28 : 32;
  return (
    <div className="flex items-center gap-2">
      <Image
        src="/brand/studio/logo/primary/studio-mark-approved-1024.png"
        alt="SupersmartX Studio"
        width={px}
        height={px}
        className="rounded"
        priority
      />
      <span className={`${size === 'sm' ? 'text-lg' : 'text-xl'} font-semibold tracking-tight text-white`}>SupersmartX</span>
    </div>
  );
}
