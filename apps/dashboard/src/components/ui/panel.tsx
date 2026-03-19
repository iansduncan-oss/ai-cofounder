import { type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface PanelProps {
  title: string;
  icon?: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  glowColor?: "chat" | "goals" | "monitor";
  headerActions?: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
}

const glowClasses: Record<string, string> = {
  chat: "panel-glow-chat",
  goals: "panel-glow-goals",
  monitor: "panel-glow-monitor",
};

export function Panel({
  title,
  icon,
  collapsed,
  onToggle,
  glowColor,
  headerActions,
  badge,
  children,
  className,
}: PanelProps) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border bg-surface-1 overflow-hidden transition-[flex] duration-200 ease-out",
        glowColor && glowClasses[glowColor],
        collapsed ? "flex-none" : "flex-1 min-h-0",
        className,
      )}
    >
      {/* Header */}
      <button
        onClick={onToggle}
        className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors shrink-0 w-full text-left"
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
        {icon && <span className="shrink-0">{icon}</span>}
        <span className="uppercase tracking-wider">{title}</span>
        {badge && <span className="ml-auto mr-1">{badge}</span>}
        {headerActions && !collapsed && (
          <span
            className="ml-auto flex items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            {headerActions}
          </span>
        )}
      </button>

      {/* Content */}
      {!collapsed && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {children}
        </div>
      )}
    </div>
  );
}
