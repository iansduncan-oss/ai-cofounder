import { useState, useMemo } from "react";
import { useGoals, useGoal, useTasks, usePendingApprovals } from "@/api/queries";
import { useUpdateGoalStatus, useApproveGoal, useRejectGoal } from "@/api/mutations";
import { GoalStatusBadge, TaskStatusBadge } from "@/components/common/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExecutionPanel } from "@/components/goals/execution-panel";
import { CreateGoalDialog } from "@/components/goals/create-goal-dialog";
import { RelativeTime } from "@/components/common/relative-time";
import { useCommandCenter } from "@/providers/command-center-provider";
import {
  Plus,
  Search,
  ChevronLeft,
  MessageSquare,
  CheckCircle,
  XCircle,
  Loader2,
} from "lucide-react";
import type { GoalPriority } from "@ai-cofounder/api-client";

const priorityColors: Record<GoalPriority, "default" | "secondary" | "warning" | "destructive"> = {
  low: "secondary",
  medium: "default",
  high: "warning",
  critical: "destructive",
};

export function GoalsPanel() {
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const { selectedGoalId, openGoal, clearSelectedGoal, focusChat } = useCommandCenter();
  const { data: approvals } = usePendingApprovals();

  // List view
  const { data: goalsData, isLoading } = useGoals("default");
  const goals = goalsData?.data;

  const filtered = useMemo(() => {
    return goals?.filter((g) => {
      if (statusFilter !== "all" && g.status !== statusFilter) return false;
      if (search && !g.title.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [goals, statusFilter, search]);

  // Detail view
  const { data: goal } = useGoal(selectedGoalId ?? "");
  const { data: tasksData } = useTasks(selectedGoalId ?? "");
  const tasks = tasksData?.data;
  const updateStatus = useUpdateGoalStatus();
  const approveGoal = useApproveGoal();
  const rejectGoal = useRejectGoal();

  const sortedTasks = tasks ? [...tasks].sort((a, b) => a.orderIndex - b.orderIndex) : [];

  // If a goal is selected, show detail view
  if (selectedGoalId && goal) {
    const canCancel = goal.status === "active" || goal.status === "draft";
    const isProposed = goal.status === "proposed";

    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 shrink-0">
          <Button variant="ghost" size="icon-sm" onClick={clearSelectedGoal}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="text-xs font-medium truncate flex-1">{goal.title}</span>
          <GoalStatusBadge status={goal.status} />
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {/* Actions */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {isProposed && (
              <>
                <Button size="sm" onClick={() => approveGoal.mutate(goal.id)} disabled={approveGoal.isPending}>
                  <CheckCircle className="mr-1 h-3 w-3" />
                  {approveGoal.isPending ? "..." : "Approve"}
                </Button>
                <Button
                  variant="destructive" size="sm"
                  onClick={() => rejectGoal.mutate({ id: goal.id })}
                  disabled={rejectGoal.isPending}
                >
                  <XCircle className="mr-1 h-3 w-3" />
                  Reject
                </Button>
              </>
            )}
            {canCancel && (
              <Button
                variant="outline" size="sm"
                onClick={() => updateStatus.mutate({ id: goal.id, status: "cancelled" })}
                disabled={updateStatus.isPending}
              >
                <XCircle className="mr-1 h-3 w-3" />
                Cancel
              </Button>
            )}
            <Button
              variant="ghost" size="sm"
              onClick={() => focusChat(`Tell me about goal: ${goal.title}`)}
            >
              <MessageSquare className="mr-1 h-3 w-3" />
              Discuss
            </Button>
          </div>

          {goal.description && (
            <p className="text-xs text-muted-foreground">{goal.description}</p>
          )}

          {/* Tasks */}
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
              Tasks ({sortedTasks.length})
            </p>
            {sortedTasks.length > 0 ? (
              <div className="space-y-1.5">
                {sortedTasks.map((task, i) => (
                  <div key={task.id} className="flex items-start gap-2 rounded-md border p-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium mt-0.5">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-medium truncate">{task.title}</p>
                        <TaskStatusBadge status={task.status} />
                      </div>
                      {task.assignedAgent && (
                        <Badge variant="outline" className="mt-1 text-[10px]">{task.assignedAgent}</Badge>
                      )}
                      {task.output && (
                        <pre className="mt-1 max-h-20 overflow-auto rounded bg-muted p-1.5 text-[10px]">{task.output}</pre>
                      )}
                      {task.error && (
                        <p className="mt-1 text-[10px] text-destructive">{task.error}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No tasks yet</p>
            )}
          </div>

          {/* Execution */}
          <ExecutionPanel goalId={goal.id} goalStatus={goal.status} />

          {/* Details */}
          <div className="text-xs space-y-1 text-muted-foreground">
            <p>Priority: <span className="text-foreground capitalize">{goal.priority}</span></p>
            <p>Created: <span className="text-foreground">{new Date(goal.createdAt).toLocaleDateString()}</span></p>
            {goal.createdBy && <p>By: <span className="text-foreground">{goal.createdBy}</span></p>}
          </div>
        </div>
      </div>
    );
  }

  // List view
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1.5 h-3 w-3 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-6 pl-6 text-xs bg-transparent border-0"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-6 rounded border bg-transparent px-1 text-[10px] text-muted-foreground"
        >
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="proposed">Proposed</option>
          <option value="draft">Draft</option>
          <option value="completed">Done</option>
        </select>
        <Button size="icon-sm" onClick={() => setShowCreate(true)} title="New Goal">
          <Plus className="h-3 w-3" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : filtered && filtered.length > 0 ? (
          <div className="divide-y">
            {filtered.map((g) => (
              <button
                key={g.id}
                onClick={() => openGoal(g.id)}
                className="flex items-start gap-2 w-full px-3 py-2 text-left hover:bg-accent/50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{g.title}</p>
                  <p className="text-[10px] text-muted-foreground">
                    <RelativeTime date={g.createdAt} />
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Badge variant={priorityColors[g.priority]} className="text-[9px] px-1.5 py-0">
                    {g.priority}
                  </Badge>
                  <GoalStatusBadge status={g.status} />
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-xs text-muted-foreground">
            <p>No goals found</p>
          </div>
        )}
      </div>

      <CreateGoalDialog open={showCreate} onClose={() => setShowCreate(false)} />
    </div>
  );
}
