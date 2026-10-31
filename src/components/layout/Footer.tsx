import { KeyboardIcon } from '@/components/icons';

interface FooterProps {
  showShortcuts?: boolean;
  /**
   * UX-009: reveals the full shortcut list. Without this the hint was inert
   * text, and the only interactive shortcut entry (the rail's "Shortcuts") only
   * exists at xl — so below xl there was no way to discover the bindings.
   */
  onShowShortcuts?: () => void;
  /**
   * Optional in-flow spacing hook, owned by the page. Nothing is passed today:
   * compact layouts used to pin a navigation bar to the bottom of the viewport
   * and push this footer above it, but those destinations moved into the
   * hamburger menu, so the footer now sits at the very bottom on its own.
   */
  className?: string;
}

export function Footer({ showShortcuts = true, onShowShortcuts, className = '' }: FooterProps) {
  return (
    <footer className={`hidden md:flex h-7 border-t border-border-subtle bg-surface items-center px-4 justify-between text-caption text-text-secondary shrink-0 ${className}`} role="contentinfo">
      <div className="flex items-center gap-4">
        {/* A real control, not a hint: the whole row is one button so there is a
            single tab stop and one accessible name. Scoped to `xl:hidden`
            deliberately — at xl the IconRail already carries a "Shortcuts" entry
            that triggers the same handler, and two live entries for one action
            on the same screen is the duplication this item is meant to remove.
            The inner spans keep their original spacing, so the row looks
            unchanged. */}
        {showShortcuts && onShowShortcuts && (
          <button
            type="button"
            onClick={onShowShortcuts}
            aria-label="Keyboard shortcuts"
            title="Show all keyboard shortcuts"
            className="hidden sm:flex items-center gap-4 text-left text-text-secondary hover:text-text-primary rounded transition-colors xl:hidden"
          >
            <span className="flex items-center gap-1.5">
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
          </button>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span>Private by design</span>
      </div>
    </footer>
  );
}
