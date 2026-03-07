import { useState } from "react";
import { usePendingTasks, usePendingApprovals, useGoals } from "@/api/queries";
import { PageHeader } from "@/components/layout/page-header";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ListSkeleton } from "@/components/common/loading-skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { RelativeTime } from "@/components/common/relative-time";
import { TaskStatusBadge, GoalStatusBadge } from "@/components/common/status-badge";
import { usePageTitle } from "@/hooks/use-page-title";
import {
  Activity as ActivityIcon,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Target,
  Clock,
  PlayCircle,
  XCircle,
} from "lucide-react";
import { Link } from "react-router";

interface ActivityEvent {
  id: string;
  type: "task" | "goal" | "approval";
  title: string;
  description?: string;
  status: string;
  timestamp: string;
  icon: typeof CheckCircle2;
  linkTo?: string;
}

export function ActivityPage() {
  usePageTitle("Activity");
  const [typeFilter, setTypeFilter] = useState<"all" | "task" | "goal" | "approval">("all");
  const [conversationId] = useState("default");

  const { data: tasks, isLoading: tasksLoading } = usePendingTasks();
  const { data: approvals, isLoading: approvalsLoading } = usePendingApprovals();
  const { data: goals, isLoading: goalsLoading } = useGoals(conversationId);

  const isLoading = tasksLoading || approvalsLoading || goalsLoading;

  // Build activity events from all sources
  const events: ActivityEvent[] = [];

  tasks?.forEach((task) => {
    const icon =
      task.status === "completed"
        ? CheckCircle2
        : task.status === "failed"
          ? AlertCircle
          : task.status === "running"
            ? PlayCircle
            : Clock;

    events.push({
      id: `task-${task.id}`,
      type: "task",
      title: task.title,
      description: task.assignedAgent
        ? `Assigned to ${task.assignedAgent}`
        : undefined,
      status: task.status,
      timestamp: task.updatedAt,
      icon,
      linkTo: `/dashboard/goals/${task.goalId}`,
    });
  });

  goals?.forEach((goal) => {
    const icon =
      goal.status === "completed"
        ? CheckCircle2
        : goal.status === "cancelled"
          ? XCircle
          : goal.status === "active"
            ? PlayCircle
            : Target;

    events.push({
      id: `goal-${goal.id}`,
      type: "goal",
      title: goal.title,
      description: goal.description,
      status: goal.status,
      timestamp: goal.updatedAt,
      icon,
      linkTo: `/dashboard/goals/${goal.id}`,
    });
  });

  approvals?.forEach((approval) => {
    events.push({
      id: `approval-${approval.id}`,
      type: "approval",
      title: approval.reason,
      description: `Requested by ${approval.requestedBy}`,
      status: approval.status,
      timestamp: approval.createdAt,
      icon: ShieldCheck,
      linkTo: "/dashboard/approvals",
    });
  });

  // Sort by timestamp descending
  events.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  const filtered =
    typeFilter === "all"
      ? events
      : events.filter((e) => e.type === typeFilter);

  const typeColors: Record<string, "default" | "secondary" | "warning"> = {
    task: "default",
    goal: "warning",
    approval: "secondary",
  };

  return (
    <div>
      <PageHeader
        title="Activity"
        description="Recent events across goals, tasks, and approvals"
        actions={
          <Select
            value={typeFilter}
            onChange={(e) =>
              setTypeFilter(e.target.value as typeof typeFilter)
            }
            className="w-36"
          >
            <option value="all">All types</option>
            <option value="task">Tasks</option>
            <option value="goal">Goals</option>
            <option value="approval">Approvals</option>
          </Select>
        }
      />

      {isLoading ? (
        <ListSkeleton rows={8} />
      ) : filtered.length > 0 ? (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-[19px] top-0 bottom-0 w-px bg-border" />

          <div className="space-y-0">
            {filtered.map((event) => {
              const Icon = event.icon;
              const content = (
                <div className="group relative flex gap-4 py-3 pl-0">
                  <div className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-card">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0 pt-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium truncate">
                        {event.title}
                      </p>
                      <Badge variant={typeColors[event.type]}>{event.type}</Badge>
                      {event.type === "task" ? (
                        <TaskStatusBadge status={event.status as never} />
                      ) : event.type === "goal" ? (
                        <GoalStatusBadge status={event.status as never} />
                      ) : (
                        <Badge variant={event.status === "pending" ? "warning" : "secondary"}>
                          {event.status}
                        </Badge>
                      )}
                    </div>
                    {event.description && (
                      <p className="mt-0.5 text-xs text-muted-foreground truncate">
                        {event.description}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      <RelativeTime date={event.timestamp} />
                    </p>
                  </div>
                </div>
              );

              return event.linkTo ? (
                <Link
                  key={event.id}
                  to={event.linkTo}
                  className="block hover:bg-accent/50 rounded-md transition-colors"
                >
                  {content}
                </Link>
              ) : (
                <div key={event.id}>{content}</div>
              );
            })}
          </div>
        </div>
      ) : (
        <EmptyState
          icon={<ActivityIcon className="h-10 w-10" />}
          title="No activity"
          description="Events will appear here as agents work on goals"
        />
      )}
    </div>
  );
}
