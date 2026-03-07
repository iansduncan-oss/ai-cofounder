import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router";
import {
  LayoutDashboard,
  Target,
  ShieldCheck,
  MessageSquare,
  Settings,
  Search,
  Brain,
  Milestone,
  Activity,
  BarChart3,
  FolderOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";

const commands = [
  { label: "Overview", to: "/dashboard", icon: LayoutDashboard },
  { label: "Goals", to: "/dashboard/goals", icon: Target },
  { label: "Milestones", to: "/dashboard/milestones", icon: Milestone },
  { label: "Approvals", to: "/dashboard/approvals", icon: ShieldCheck },
  { label: "Activity", to: "/dashboard/activity", icon: Activity },
  { label: "Memories", to: "/dashboard/memories", icon: Brain },
  { label: "Workspace", to: "/dashboard/workspace", icon: FolderOpen },
  { label: "Usage", to: "/dashboard/usage", icon: BarChart3 },
  { label: "Chat", to: "/dashboard/chat", icon: MessageSquare },
  { label: "Settings", to: "/dashboard/settings", icon: Settings },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const filtered = commands.filter((c) =>
    c.label.toLowerCase().includes(query.toLowerCase()),
  );

  // Global Cmd+K listener
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleSelect = useCallback(
    (to: string) => {
      navigate(to);
      setOpen(false);
    },
    [navigate],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && filtered[selectedIndex]) {
      handleSelect(filtered[selectedIndex].to);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[20vh] bg-black/50 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="w-full max-w-md rounded-lg border bg-card shadow-2xl animate-scale-in">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search pages..."
            className="flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            ESC
          </kbd>
        </div>
        {filtered.length > 0 ? (
          <div className="p-1">
            {filtered.map((cmd, i) => {
              const Icon = cmd.icon;
              return (
                <button
                  key={cmd.to}
                  onClick={() => handleSelect(cmd.to)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                    i === selectedIndex
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {cmd.label}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="p-4 text-center text-sm text-muted-foreground">
            No results
          </div>
        )}
      </div>
    </div>
  );
}
