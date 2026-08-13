'use client';

import { ReactNode } from 'react';

interface Tab {
  key: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (key: string) => void;
}

export function Tabs({ tabs, activeTab, onTabChange }: TabsProps) {
  return (
    <div className="flex items-center gap-0.5 p-0.5 bg-elevated rounded-lg">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.key;
        return (
          <button
            key={tab.key}
            onClick={() => !tab.disabled && onTabChange(tab.key)}
            disabled={tab.disabled}
            className={`
              flex items-center gap-1.5 px-3 py-1.5 flex-1 justify-center
              text-xs font-medium rounded-md
              transition-all duration-150 ease-out
              ${isActive
                ? 'bg-surface text-text-primary shadow-sm'
                : 'text-text-muted hover:text-text-secondary'
              }
              ${tab.disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
            `}
          >
            {tab.icon}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
