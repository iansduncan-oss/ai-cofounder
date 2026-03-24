import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
  Loader2,
  ListTodo,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useGlobalSearch } from "@/api/queries";

const NAV_COMMANDS = [
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

interface ResultItem {
  key: string;
  label: string;
  sublabel?: string;
  to: string;
  icon: typeof Target;
  category: string;
}

function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const debouncedQuery = useDebounce(query, 300);
  const { data: searchResults, isFetching } = useGlobalSearch(debouncedQuery);

  // Build flat list of all results
  const allItems = useMemo(() => {
    const items: ResultItem[] = [];

    // Nav links (always filtered locally)
    const filteredNav = NAV_COMMANDS.filter((c) =>
      c.label.toLowerCase().includes(query.toLowerCase()),
    );
    for (const cmd of filteredNav) {
      items.push({ key: `nav-${cmd.to}`, label: cmd.label, to: cmd.to, icon: cmd.icon, category: "Pages" });
    }

    if (!searchResults) return items;

    for (const g of searchResults.goals) {
      items.push({
        key: `goal-${g.id}`,
        label: g.title,
        sublabel: g.status,
        to: `/dashboard/goals/${g.id}`,
        icon: Target,
        category: "Goals",
      });
    }
    for (const t of searchResults.tasks) {
      items.push({
        key: `task-${t.id}`,
        label: t.title,
        sublabel: t.status,
        to: `/dashboard/goals/${t.goalId}`,
        icon: ListTodo,
        category: "Tasks",
      });
    }
    for (const c of searchResults.conversations) {
      items.push({
        key: `conv-${c.id}`,
        label: c.title || "Untitled conversation",
        to: `/dashboard/chat?conversation=${c.id}`,
        icon: MessageSquare,
        category: "Conversations",
      });
    }
    for (const m of searchResults.memories) {
      items.push({
        key: `mem-${m.id}`,
        label: m.key,
        sublabel: m.category,
        to: "/dashboard/memories",
        icon: Brain,
        category: "Memories",
      });
    }

    return items;
  }, [query, searchResults]);

  // Group items by category for rendering
  const grouped = useMemo(() => {
    const groups: { category: string; items: (ResultItem & { flatIndex: number })[] }[] = [];
    let flatIndex = 0;
    let currentCategory = "";
    for (const item of allItems) {
      if (item.category !== currentCategory) {
        currentCategory = item.category;
        groups.push({ category: currentCategory, items: [] });
      }
      groups[groups.length - 1].items.push({ ...item, flatIndex });
      flatIndex++;
    }
    return groups;
  }, [allItems]);

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

  // Reset selection when items change
  useEffect(() => {
    setSelectedIndex(0);
  }, [allItems.length]);

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
      setSelectedIndex((i) => Math.min(i + 1, allItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && allItems[selectedIndex]) {
      handleSelect(allItems[selectedIndex].to);
    }
  };

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.querySelector("[data-selected='true']");
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-4 sm:pt-[20vh] bg-black/50 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="mx-3 sm:mx-0 w-full max-w-[calc(100%-1.5rem)] sm:max-w-lg rounded-lg border bg-card shadow-2xl animate-scale-in">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search everything..."
            aria-label="Search everything"
            className="flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
          />
          {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading" />}
          <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground" aria-hidden="true">
            ESC
          </kbd>
        </div>
        {grouped.length > 0 ? (
          <div ref={listRef} className="max-h-80 overflow-y-auto p-1">
            {grouped.map((group) => (
              <div key={group.category}>
                <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  {group.category}
                </div>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.key}
                      data-selected={item.flatIndex === selectedIndex}
                      onClick={() => handleSelect(item.to)}
                      aria-label={`Go to ${item.label}`}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                        item.flatIndex === selectedIndex
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="truncate">{item.label}</span>
                      {item.sublabel && (
                        <span className="ml-auto text-xs text-muted-foreground">{item.sublabel}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
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
