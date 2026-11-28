'use client';

import { Modal } from '@/components/ui/Modal';

interface ShortcutRow {
  keys: string[];
  action: string;
}

/**
 * The bindings actually registered by `useKeyboardShortcuts` — this list is
 * documentation, not a second source of truth: it must never name a binding
 * the hook does not implement, and a binding the hook adds belongs here too.
 */
const SHORTCUTS: ShortcutRow[] = [
  { keys: ['Space'], action: 'Start / stop recording' },
  { keys: ['P'], action: 'Pause / resume recording' },
  { keys: ['M'], action: 'Mute / unmute microphone' },
  { keys: ['↑', '↓'], action: 'Nudge teleprompter text' },
  { keys: ['Esc'], action: 'Close the export sheet' },
];

/**
 * The studio's keyboard shortcuts as a persistent dialog. This replaced a
 * five-second toast that carried the same list: the toast was unreadable at
 * that speed, could not be re-opened without re-firing, and vanished the
 * moment the user tried a key. Both entry points (IconRail "Shortcuts" and
 * the footer hint) open this dialog now.
 */
export function ShortcutsDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Keyboard shortcuts" maxWidth="max-w-md">
      <dl className="flex flex-col divide-y divide-border-subtle">
        {SHORTCUTS.map(({ keys, action }) => (
          <div key={action} className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
            <dt className="text-[13px] text-text-secondary">{action}</dt>
            <dd className="flex shrink-0 items-center gap-1">
              {keys.map((key) => (
                <kbd
                  key={key}
                  className="inline-flex min-w-[24px] items-center justify-center rounded-md border border-border-subtle bg-elevated px-1.5 py-0.5 font-mono text-[11px] font-semibold text-text-primary"
                >
                  {key}
                </kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-[11px] leading-relaxed text-text-muted">
        Shortcuts are ignored while you are typing in a field or using a control, so they never
        hijack the keyboard.
      </p>
    </Modal>
  );
}
