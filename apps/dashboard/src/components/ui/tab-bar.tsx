import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Tab {
  id: string;
  label: string;
  icon: ReactNode;
  notificationCount?: number;
}

interface TabBarProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (id: string) => void;
}

export function TabBar({ tabs, activeTab, onTabChange }: TabBarProps) {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t bg-surface-1 px-2 pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="Main navigation"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={cn(
            "relative flex flex-col items-center gap-0.5 px-3 py-2 text-[10px] font-medium transition-colors",
            activeTab === tab.id
              ? "text-primary"
              : "text-muted-foreground",
          )}
          aria-current={activeTab === tab.id ? "page" : undefined}
        >
          {tab.icon}
          <span>{tab.label}</span>
          {tab.notificationCount != null && tab.notificationCount > 0 && (
            <span className="absolute -top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-white">
              {tab.notificationCount > 99 ? "99+" : tab.notificationCount}
            </span>
          )}
        </button>
      ))}
    </nav>
  );
}
