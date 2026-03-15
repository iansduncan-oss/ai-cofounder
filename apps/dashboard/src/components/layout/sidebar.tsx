import { NavLink } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Monitor,
  Target,
  ShieldCheck,
  MessageSquare,
  Settings,
  Menu,
  X,
  Sun,
  Moon,
  Brain,
  Milestone,
  Activity,
  BarChart3,
  FolderOpen,
  LogOut,
  Bot,
  GitBranch,
  Sparkles,
  BookOpen,
  Workflow,
  Bell,
  PlayCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiClient } from "@/api/client";
import { queryKeys } from "@/lib/query-keys";
import { useState, useEffect, useRef } from "react";
import { useTheme } from "@/hooks/use-theme";
import { useAuth } from "@/hooks/use-auth";
import { NotificationBell } from "@/components/common/notification-bell";
import { ProjectSwitcher } from "@/components/layout/project-switcher";

const navItems = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Overview", end: true },
  { to: "/dashboard/hud", icon: Monitor, label: "HUD" },
  { to: "/dashboard/goals", icon: Target, label: "Goals" },
  { to: "/dashboard/approvals", icon: ShieldCheck, label: "Approvals" },
  { to: "/dashboard/chat", icon: MessageSquare, label: "Chat" },
  { to: "/dashboard/memories", icon: Brain, label: "Memories" },
  { to: "/dashboard/milestones", icon: Milestone, label: "Milestones" },
  { to: "/dashboard/activity", icon: Activity, label: "Activity" },
  { to: "/dashboard/usage", icon: BarChart3, label: "Usage" },
  { to: "/dashboard/workspace", icon: FolderOpen, label: "Workspace" },
  { to: "/dashboard/pipelines", icon: GitBranch, label: "Pipelines" },
  { to: "/dashboard/n8n", icon: Workflow, label: "N8n Workflows" },
  { to: "/dashboard/persona", icon: Bot, label: "Persona" },
  { to: "/dashboard/patterns", icon: Sparkles, label: "Patterns" },
  { to: "/dashboard/journal", icon: BookOpen, label: "Journal" },
  { to: "/dashboard/autonomous", icon: PlayCircle, label: "Autonomous" },
  { to: "/dashboard/notifications", icon: Bell, label: "Notifications" },
  { to: "/dashboard/settings", icon: Settings, label: "Settings" },
];

export function Sidebar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const { theme, toggleTheme } = useTheme();
  const { isAuthenticated, logout } = useAuth();

  const { data: health } = useQuery({
    queryKey: queryKeys.health.status,
    queryFn: () => apiClient.health(),
    refetchInterval: 60_000,
  });

  // Close on outside click
  useEffect(() => {
    if (!mobileOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) {
        setMobileOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [mobileOpen]);

  // Close on Escape
  useEffect(() => {
    if (!mobileOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [mobileOpen]);

  const navContent = (
    <>
      <div className="flex items-center justify-between border-b px-4 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
            AI
          </div>
          <span className="text-sm font-semibold">AI Cofounder</span>
        </div>
        <button
          className="md:hidden rounded-md p-1 hover:bg-accent"
          onClick={() => setMobileOpen(false)}
          aria-label="Close sidebar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <ProjectSwitcher />

      <nav className="flex-1 space-y-1 px-2 py-3">
        {navItems.map(({ to, icon: Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs">
            <div
              className={cn(
                "h-2 w-2 rounded-full",
                health?.status === "ok" ? "bg-emerald-500" : "bg-amber-500",
              )}
            />
            <span className="text-muted-foreground">
              {health?.status === "ok" ? "System healthy" : "Checking..."}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <NotificationBell />
            <button
              onClick={toggleTheme}
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              {theme === "dark" ? (
                <Sun className="h-3.5 w-3.5" />
              ) : (
                <Moon className="h-3.5 w-3.5" />
              )}
            </button>
            {isAuthenticated && (
              <button
                onClick={logout}
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-destructive transition-colors"
                aria-label="Sign out"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="text-[10px] text-muted-foreground">
          <kbd className="rounded border bg-muted px-1 py-0.5">⌘K</kbd> Quick nav
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
        aria-label="Open sidebar"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 md:hidden animate-fade-in" />
      )}

      {/* Sidebar — desktop: always visible, mobile: slide-in */}
      <aside
        ref={sidebarRef}
        className={cn(
          "flex h-screen w-56 flex-col border-r bg-card transition-transform duration-200",
          "hidden md:flex",
          mobileOpen &&
            "!fixed inset-y-0 left-0 z-50 !flex animate-slide-in-left",
        )}
      >
        {navContent}
      </aside>
    </>
  );
}
