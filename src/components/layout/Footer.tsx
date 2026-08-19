import { KeyboardIcon } from '@/components/icons';

export function Footer() {
  return (
    <footer className="hidden md:flex h-7 border-t border-border-subtle bg-surface items-center px-4 justify-between text-[10px] text-text-muted shrink-0 safe-area-bottom" role="contentinfo">
      <div className="flex items-center gap-4">
        <span className="hidden sm:flex items-center gap-1.5">
          <KeyboardIcon className="w-3 h-3" />
          Space to record
        </span>
        <span className="hidden sm:inline">
          <kbd className="px-1 py-0.5 bg-elevated rounded text-[9px] font-mono border border-border-subtle">↑</kbd>{' '}
          <kbd className="px-1 py-0.5 bg-elevated rounded text-[9px] font-mono border border-border-subtle">↓</kbd>{' '}
          Nudge
        </span>
        <span className="hidden sm:inline">
          <kbd className="px-1 py-0.5 bg-elevated rounded text-[9px] font-mono border border-border-subtle">Esc</kbd>{' '}
          Close
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden sm:inline">Everything stays on your device</span>
        <span className="sm:hidden">Private by design</span>
      </div>
    </footer>
  );
}
