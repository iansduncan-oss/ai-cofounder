import { useNavigate, useLocation } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Monitor,
  Target,
  MessageSquare,
  Settings,
  Menu,
  X,
  Sun,
  Moon,
  LogOut,
  Bot,
  GitBranch,
  Sparkles,
  BookOpen,
  Workflow,
  Bell,
  PlayCircle,
  Inbox,
  Mail,
  CalendarDays,
  BarChart3,
  ShieldCheck,
  Brain,
  Milestone,
  Activity,
  FolderOpen,
  ListChecks,
  Boxes,
  Scale,
  LayoutTemplate,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiClient } from "@/api/client";
import { queryKeys } from "@/lib/query-keys";
import { useState, useEffect, useRef } from "react";
import { useTheme } from "@/hooks/use-theme";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";

interface NavItem {
  icon: LucideIcon;
  label: string;
  /** If path is null, it's the command center (index) */
  path: string | null;
  /** If true, opens in drawer instead of navigating */
  drawer?: boolean;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    label: "Core",
    items: [
      { icon: Monitor, label: "Command Center", path: null },
      { icon: Target, label: "Goals", path: "/dashboard/goals" },
      { icon: ShieldCheck, label: "Approvals", path: "/dashboard/approvals", drawer: true },
      { icon: ListChecks, label: "Follow-Ups", path: "/dashboard/follow-ups", drawer: true },
      { icon: BarChart3, label: "Analytics", path: "/dashboard/analytics" },
    ],
  },
  {
    label: "Integrations",
    items: [
      { icon: Mail, label: "Gmail", path: "/dashboard/gmail", drawer: true },
      { icon: CalendarDays, label: "Calendar", path: "/dashboard/calendar", drawer: true },
      { icon: Workflow, label: "N8n", path: "/dashboard/n8n", drawer: true },
      { icon: GitBranch, label: "Pipelines", path: "/dashboard/pipelines", drawer: true },
      { icon: LayoutTemplate, label: "Templates", path: "/dashboard/pipeline-templates", drawer: true },
    ],
  },
  {
    label: "System",
    items: [
      { icon: Brain, label: "Memories", path: "/dashboard/memories", drawer: true },
      { icon: Milestone, label: "Milestones", path: "/dashboard/milestones", drawer: true },
      { icon: Activity, label: "Activity", path: "/dashboard/activity", drawer: true },
      { icon: FolderOpen, label: "Workspace", path: "/dashboard/workspace", drawer: true },
      { icon: Bot, label: "Persona", path: "/dashboard/persona", drawer: true },
      { icon: Sparkles, label: "Patterns", path: "/dashboard/patterns", drawer: true },
      { icon: BookOpen, label: "Journal", path: "/dashboard/journal", drawer: true },
      { icon: Boxes, label: "Subagents", path: "/dashboard/subagents", drawer: true },
      { icon: Scale, label: "Decisions", path: "/dashboard/decisions", drawer: true },
      { icon: PlayCircle, label: "Autonomous", path: "/dashboard/autonomous", drawer: true },
      { icon: Inbox, label: "DLQ", path: "/dashboard/dlq", drawer: true },
      { icon: Bell, label: "Notifications", path: "/dashboard/notifications", drawer: true },
      { icon: Settings, label: "Settings", path: "/dashboard/settings", drawer: true },
    ],
  },
];

interface NavRailProps {
  onDrawerOpen: (path: string) => void;
}

export function NavRail({ onDrawerOpen }: NavRailProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { isAuthenticated, logout } = useAuth();

  const { data: health } = useQuery({
    queryKey: queryKeys.health.status,
    queryFn: () => apiClient.health(),
    refetchInterval: 60_000,
  });

  // Lock body scroll when mobile drawer is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.classList.add("overflow-hidden");
    } else {
      document.body.classList.remove("overflow-hidden");
    }
    return () => document.body.classList.remove("overflow-hidden");
  }, [mobileOpen]);

  // Close mobile on outside click
  useEffect(() => {
    if (!mobileOpen) return;
    const handler = (e: MouseEvent) => {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) setMobileOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [mobileOpen]);

  useEffect(() => {
    if (!mobileOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileOpen(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [mobileOpen]);

  const handleNavClick = (item: NavItem) => {
    setMobileOpen(false);
    if (item.path === null) {
      navigate("/dashboard");
    } else if (item.drawer) {
      onDrawerOpen(item.path);
    } else {
      navigate(item.path);
    }
  };

  const isActive = (item: NavItem) => {
    if (item.path === null) return location.pathname === "/dashboard";
    return location.pathname.startsWith(item.path);
  };

  const railContent = (
    <>
      {/* Logo */}
      <div className="flex h-12 items-center justify-center border-b shrink-0">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-[10px] font-bold text-primary-foreground">
          AI
        </div>
      </div>

      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto py-2 space-y-3" aria-label="Main navigation">
        {navSections.map((section) => (
          <div key={section.label}>
            {!mobileOpen && (
              <div className="mx-2 mb-1 hidden md:block">
                <div className="h-px bg-border" />
              </div>
            )}
            {mobileOpen && (
              <p className="px-4 mb-1 text-[9px] uppercase tracking-widest text-muted-foreground">{section.label}</p>
            )}
            <div className="space-y-0.5 px-1.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const active = isActive(item);
                return (
                  <div key={item.label} className="relative">
                    <button
                      onClick={() => handleNavClick(item)}
                      onMouseEnter={() => setHoveredItem(item.label)}
                      onMouseLeave={() => setHoveredItem(null)}
                      className={cn(
                        "flex items-center gap-3 rounded-md transition-all",
                        mobileOpen ? "w-full px-3 py-2 text-sm" : "w-full justify-center p-2",
                        active
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground hover:scale-105",
                      )}
                      aria-label={item.label}
                      aria-current={active ? "page" : undefined}
                    >
                      <Icon className={cn("shrink-0", mobileOpen ? "h-4 w-4" : "h-4.5 w-4.5")} />
                      {mobileOpen && <span>{item.label}</span>}
                    </button>
                    {/* Tooltip (desktop only, non-mobile) */}
                    {!mobileOpen && hoveredItem === item.label && (
                      <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 z-50 hidden md:block">
                        <div className="whitespace-nowrap rounded-md bg-popover border px-2 py-1 text-xs shadow-md animate-fade-in">
                          {item.label}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t py-2 px-1.5 space-y-1 shrink-0">
        {/* Health dot */}
        <div className="flex items-center justify-center py-1">
          <div
            className={cn(
              "h-2 w-2 rounded-full",
              health?.status === "ok" ? "bg-emerald-500" : "bg-amber-500",
            )}
            title={health?.status === "ok" ? "System healthy" : "Checking..."}
          />
        </div>
        <div className="flex flex-col items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggleTheme}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </Button>
          {isAuthenticated && (
            <Button variant="ghost" size="icon-sm" onClick={logout} title="Sign out">
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile hamburger */}
      <button
        className="fixed top-3 left-3 z-50 rounded-md border bg-card p-2 md:hidden"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 md:hidden animate-fade-in" aria-hidden="true" />
      )}

      {/* Rail — desktop: 56px icon-only, mobile: slide-in with labels */}
      <aside
        ref={sidebarRef}
        className={cn(
          "flex h-screen flex-col border-r bg-surface-1 transition-transform duration-200",
          "hidden md:flex w-14",
          mobileOpen && "!fixed inset-y-0 left-0 z-50 !flex w-56 animate-slide-in-left",
        )}
      >
        {mobileOpen && (
          <button
            className="absolute top-3 right-3 rounded-md p-1 hover:bg-accent z-10"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        {railContent}
      </aside>
    </>
  );
}
