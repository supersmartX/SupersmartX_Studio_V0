'use client';

import { INSPIRATION_OPTIONS } from '@/constants';
import { Select } from '@/components/ui/Select';

interface InspirationLoaderProps {
  onLoad: (key: string) => void;
}

export function InspirationLoader({ onLoad }: InspirationLoaderProps) {
  return (
    <Select
      label="Need Inspiration?"
      defaultValue=""
      onChange={(value) => {
        if (value) onLoad(value);
      }}
      options={[
        { value: '', label: 'Load a preset script...' },
        ...INSPIRATION_OPTIONS.map((opt) => ({ value: opt.key, label: opt.label })),
      ]}
    />
  );
}
