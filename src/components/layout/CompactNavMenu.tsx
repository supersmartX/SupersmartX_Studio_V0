'use client';

import { useState, useRef, useCallback } from 'react';
import type { TabType } from '@/types';
import {
  MenuIcon,
  CameraIcon,
  BookOpenIcon,
  PlusIcon,
  SettingsIcon,
} from '@/components/icons';
import { useDismissOnOutsideClick } from '@/hooks/useDismissOnOutsideClick';

interface CompactNavMenuProps {
  activePanel: TabType | 'record' | 'share';
  /** Pure panel/navigation switch. Never a session reset (FC-1.0 DC-3). */
  onPanelChange: (panel: TabType | 'record' | 'share') => void;
  /**
   * The EXPLICIT "New Video" action — the only compact-layout entry point
   * that starts a fresh creation session (mirrors the desktop rail's entry).
   */
  onNewVideo: () => void;
  onSettingsToggle: () => void;
}

interface NavItem {
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
  isActive?: boolean;
}

/**
 * The compact (< xl) studio navigation.
 *
 * This used to be a persistent 4-item bar pinned to the bottom of the viewport
 * on every mobile and tablet width, permanently spending 3.5rem of screen on
 * chrome that is touched a handful of times per session. It is now a single
 * hamburger in the app bar that discloses the same four destinations, so the
 * canvas and the transport keep that space. The items, their labels, their
 * active state and their handlers are unchanged — this is a re-arrangement,
 * not a redesign.
 *
 * A disclosure (button + `aria-expanded` + a panel of ordinary buttons) is the
 * right pattern here rather than `role="menu"`: it is a list of navigation
 * destinations, it is fully operable with Tab and Escape alone, and it does not
 * promise the arrow-key roving focus that a real menu widget owes the user.
 */
export function CompactNavMenu({
  activePanel,
  onPanelChange,
  onNewVideo,
  onSettingsToggle,
}: CompactNavMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setIsOpen(false), []);
  // Outside-click AND Escape both dismiss (Escape is handled inside the hook's
  // key listener, so keyboard users are never trapped in the panel).
  useDismissOnOutsideClick(containerRef, isOpen, close);

  // Close FIRST, then act: the panel unmounts on selection, and running the
  // handler afterwards keeps navigation and the session-reset action from
  // firing against a tree that is already tearing down.
  const run = (fn: () => void) => {
    close();
    fn();
  };

  const items: NavItem[] = [
    {
      label: 'Studio',
      icon: <CameraIcon className="w-4 h-4" />,
      onSelect: () => run(() => onPanelChange('studio')),
      isActive: activePanel === 'studio',
    },
    // DC-3: session reset must be an affordance LABELED "New Video", never
    // smuggled in behind a nav tab called "Studio". Destructive to the session
    // only — the previous take stays in the library.
    {
      label: 'New Video',
      icon: <PlusIcon className="w-4 h-4" />,
      onSelect: () => run(onNewVideo),
    },
    {
      label: 'Recordings',
      icon: <BookOpenIcon className="w-4 h-4" />,
      onSelect: () => run(() => onPanelChange('library')),
      isActive: activePanel === 'library',
    },
    {
      label: 'Settings',
      icon: <SettingsIcon className="w-4 h-4" />,
      onSelect: () => run(onSettingsToggle),
    },
  ];

  return (
    <nav
      className="xl:hidden relative shrink-0 mr-1"
      aria-label="Compact navigation"
      ref={containerRef}
    >
      <button
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label={isOpen ? 'Close navigation menu' : 'Open navigation menu'}
        className="flex items-center justify-center w-9 h-9 -ml-1 rounded-md text-text-secondary hover:text-text-primary hover:bg-elevated transition-colors min-w-[44px] min-h-[44px]"
      >
        <MenuIcon className="w-5 h-5" />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-1 w-56 bg-surface border border-border-default rounded-lg shadow-lg py-1 z-50">
          {items.map((item) => (
            <button
              key={item.label}
              onClick={item.onSelect}
              // `aria-current` mirrors the bottom bar it replaces, so the active
              // destination stays announced rather than only being coloured.
              aria-current={item.isActive ? 'page' : undefined}
              className={`w-full text-left px-3 py-2.5 text-[13px] font-medium flex items-center gap-2.5 transition-colors ${
                item.isActive
                  ? 'text-accent-text bg-accent/15'
                  : 'text-text-secondary hover:text-text-primary hover:bg-elevated'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}
