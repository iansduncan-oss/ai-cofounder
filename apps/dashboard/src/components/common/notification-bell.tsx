import { useState, useRef, useEffect } from "react";
import { usePendingApprovals, usePendingTasks } from "@/api/queries";
import { Bell } from "lucide-react";
import { Link } from "react-router";
import { RelativeTime } from "./relative-time";

interface NotificationItem {
  id: string;
  title: string;
  type: "approval" | "task";
  timestamp: string;
  linkTo: string;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: approvals } = usePendingApprovals();
  const { data: tasks } = usePendingTasks();

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const notifications: NotificationItem[] = [];

  approvals?.slice(0, 5).forEach((a) => {
    notifications.push({
      id: `approval-${a.id}`,
      title: `Approval: ${a.reason}`,
      type: "approval",
      timestamp: a.createdAt,
      linkTo: "/dashboard/approvals",
    });
  });

  tasks
    ?.filter((t) => t.status === "failed")
    .slice(0, 5)
    .forEach((t) => {
      notifications.push({
        id: `task-${t.id}`,
        title: `Failed: ${t.title}`,
        type: "task",
        timestamp: t.updatedAt,
        linkTo: `/dashboard/goals/${t.goalId}`,
      });
    });

  notifications.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const count =
    (approvals?.length ?? 0) + (tasks?.filter((t) => t.status === "failed").length ?? 0);

  return (
    <div ref={ref} className="relative">
      <button
        className="relative rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
        onClick={() => setOpen(!open)}
        aria-label="Notifications"
      >
        <Bell className="h-3.5 w-3.5" />
        {count > 0 && (
          <>
            <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-destructive animate-ping opacity-75" />
            <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-destructive-foreground">
              {count > 9 ? "9+" : count}
            </span>
          </>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-72 rounded-lg border bg-card shadow-lg animate-scale-in z-50">
          <div className="border-b px-3 py-2">
            <p className="text-xs font-semibold">Notifications</p>
          </div>
          {notifications.length > 0 ? (
            <div className="max-h-64 overflow-y-auto divide-y">
              {notifications.map((n) => (
                <Link
                  key={n.id}
                  to={n.linkTo}
                  className="block px-3 py-2 text-xs hover:bg-accent transition-colors"
                  onClick={() => setOpen(false)}
                >
                  <p className="font-medium truncate">{n.title}</p>
                  <p className="mt-0.5 text-muted-foreground">
                    <RelativeTime date={n.timestamp} />
                  </p>
                </Link>
              ))}
            </div>
          ) : (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              No new notifications
            </div>
          )}
        </div>
      )}
    </div>
  );
}
