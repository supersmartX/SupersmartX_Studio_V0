'use client';

import { useState } from 'react';
import { INSPIRATION_OPTIONS } from '@/constants';
import { Select } from '@/components/ui/Select';

interface InspirationLoaderProps {
  onLoad: (key: string) => void;
  hasExistingScript?: boolean;
}

export function InspirationLoader({ onLoad, hasExistingScript = false }: InspirationLoaderProps) {
  const [pendingKey, setPendingKey] = useState('');

  const handleChange = (value: string) => {
    if (!value) return;
    if (hasExistingScript) {
      setPendingKey(value);
      if (!window.confirm('Load preset script? This will replace your current script.')) {
        setPendingKey('');
        return;
      }
    }
    onLoad(value);
    setPendingKey('');
  };

  return (
    <Select
      label="Need Inspiration?"
      value={pendingKey}
      defaultValue=""
      onChange={handleChange}
      options={[
        { value: '', label: 'Load a preset script...' },
        ...INSPIRATION_OPTIONS.map((opt) => ({ value: opt.key, label: opt.label })),
      ]}
    />
  );
}
