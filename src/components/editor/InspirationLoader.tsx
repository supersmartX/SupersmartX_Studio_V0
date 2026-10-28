'use client';

import { useState } from 'react';
import { INSPIRATION_OPTIONS } from '@/constants';
import { Select } from '@/components/ui/Select';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

interface InspirationLoaderProps {
  onLoad: (key: string) => void;
  hasExistingScript?: boolean;
}

export function InspirationLoader({ onLoad, hasExistingScript = false }: InspirationLoaderProps) {
  const [pendingKey, setPendingKey] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleChange = (value: string) => {
    if (!value) return;
    if (hasExistingScript) {
      // Loading a preset overwrites the draft; ask through the shared confirm.
      // The select stays on the pending option behind the dialog so cancelling
      // returns it to its previous value rather than silently keeping the new
      // label with the old script.
      setPendingKey(value);
      setConfirmOpen(true);
      return;
    }
    onLoad(value);
  };

  return (
    <>
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
      <ConfirmDialog
        isOpen={confirmOpen}
        title="Load preset script?"
        message="This replaces your current script. The draft in this browser will be lost."
        confirmLabel="Load preset"
        onConfirm={() => {
          const key = pendingKey;
          setConfirmOpen(false);
          setPendingKey('');
          onLoad(key);
        }}
        onCancel={() => {
          setConfirmOpen(false);
          setPendingKey('');
        }}
      />
    </>
  );
}
