import { useState } from "react";
import { useParams, Link } from "react-router";
import { useGoal, useTasks } from "@/api/queries";
import { useUpdateGoalStatus, useApproveGoal, useRejectGoal } from "@/api/mutations";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { GoalStatusBadge, TaskStatusBadge } from "@/components/common/status-badge";
import { Badge } from "@/components/ui/badge";
import { ListSkeleton } from "@/components/common/loading-skeleton";
import { ExecutionPanel } from "@/components/goals/execution-panel";
import { usePageTitle } from "@/hooks/use-page-title";
import { formatDate } from "@/lib/utils";
import { ChevronRight, AlertTriangle, XCircle, CheckCircle, ShieldAlert } from "lucide-react";
import type { GoalStatus } from "@ai-cofounder/api-client";

export function GoalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: goal, isLoading: goalLoading, error: goalError } = useGoal(id!);
  const { data: tasksData, isLoading: tasksLoading } = useTasks(id!);
  const tasks = tasksData?.data;
  const updateStatus = useUpdateGoalStatus();
  const approveGoal = useApproveGoal();
  const rejectGoal = useRejectGoal();

  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    status: GoalStatus;
    label: string;
  }>({ open: false, status: "cancelled", label: "" });

  usePageTitle(goal?.title ?? "Goal");

  const handleStatusChange = (status: GoalStatus, label: string) => {
    if (status === "cancelled") {
      setConfirmDialog({ open: true, status, label });
    } else {
      updateStatus.mutate({ id: id!, status });
    }
  };

  const confirmStatusChange = () => {
    updateStatus.mutate(
      { id: id!, status: confirmDialog.status },
      { onSuccess: () => setConfirmDialog((d) => ({ ...d, open: false })) },
    );
  };

  if (goalLoading) return <ListSkeleton rows={3} />;

  if (goalError) {
    return (
      <div>
        <div className="mb-4">
          <Link to="/dashboard/goals">
            <Button variant="ghost" size="sm">
              <ChevronRight className="mr-1 h-3 w-3 rotate-180" />
              Back to Goals
            </Button>
          </Link>
        </div>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <AlertTriangle className="mb-3 h-8 w-8 text-destructive" />
          <p className="text-sm font-medium">Failed to load goal</p>
          <p className="mt-1 text-xs text-muted-foreground">{goalError.message}</p>
        </div>
      </div>
    );
  }

  if (!goal) return <p className="text-muted-foreground">Goal not found</p>;

  const sortedTasks = tasks
    ? [...tasks].sort((a, b) => a.orderIndex - b.orderIndex)
    : [];

  const canCancel = goal.status === "active" || goal.status === "draft";
  const isProposed = goal.status === "proposed";

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-1 text-sm text-muted-foreground">
        <Link to="/dashboard" className="hover:text-foreground transition-colors">
          Dashboard
        </Link>
        <ChevronRight className="h-3 w-3" />
        <Link to="/dashboard/goals" className="hover:text-foreground transition-colors">
          Goals
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground truncate max-w-[200px]">{goal.title}</span>
      </div>

      <PageHeader
        title={goal.title}
        description={goal.description}
        actions={
          <div className="flex items-center gap-2">
            {isProposed && (
              <>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => approveGoal.mutate(id!)}
                  disabled={approveGoal.isPending}
                >
                  <CheckCircle className="mr-1 h-3 w-3" />
                  {approveGoal.isPending ? "Approving..." : "Approve"}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => rejectGoal.mutate({ id: id! })}
                  disabled={rejectGoal.isPending}
                >
                  <XCircle className="mr-1 h-3 w-3" />
                  {rejectGoal.isPending ? "Rejecting..." : "Reject"}
                </Button>
              </>
            )}
            {canCancel && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => handleStatusChange("cancelled", "Cancel")}
                disabled={updateStatus.isPending}
              >
                <XCircle className="mr-1 h-3 w-3" />
                Cancel Goal
              </Button>
            )}
            <GoalStatusBadge status={goal.status} />
          </div>
        }
      />

      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tasks</CardTitle>
            </CardHeader>
            <CardContent>
              {tasksLoading ? (
                <ListSkeleton rows={3} />
              ) : sortedTasks.length > 0 ? (
                <div className="space-y-2">
                  {sortedTasks.map((task, i) => (
                    <div
                      key={task.id}
                      className="flex items-start gap-3 rounded-md border p-3"
                    >
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium">{task.title}</p>
                          <TaskStatusBadge status={task.status} />
                        </div>
                        {task.description && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {task.description}
                          </p>
                        )}
                        {task.assignedAgent && (
                          <Badge variant="outline" className="mt-1">
                            {task.assignedAgent}
                          </Badge>
                        )}
                        {task.output && (
                          <pre className="mt-2 max-h-32 overflow-auto rounded bg-muted p-2 text-xs">
                            {task.output}
                          </pre>
                        )}
                        {task.error && (
                          <p className="mt-1 text-xs text-destructive">
                            {task.error}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No tasks created yet
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <span className="text-muted-foreground">Priority</span>
                <p className="font-medium capitalize">{goal.priority}</p>
              </div>
              {goal.scope && (
                <div>
                  <span className="text-muted-foreground">Scope</span>
                  <p className="font-medium capitalize flex items-center gap-1">
                    {(goal.scope === "external" || goal.scope === "destructive") && (
                      <ShieldAlert className="h-3.5 w-3.5 text-warning" />
                    )}
                    {goal.scope}
                  </p>
                </div>
              )}
              <div>
                <span className="text-muted-foreground">Created</span>
                <p className="font-medium">{formatDate(goal.createdAt)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Updated</span>
                <p className="font-medium">{formatDate(goal.updatedAt)}</p>
              </div>
              {goal.createdBy && (
                <div>
                  <span className="text-muted-foreground">Created By</span>
                  <p className="font-medium">{goal.createdBy}</p>
                </div>
              )}
              <div>
                <span className="text-muted-foreground">Conversation</span>
                <p className="font-mono text-xs">{goal.conversationId}</p>
              </div>
            </CardContent>
          </Card>

          <ExecutionPanel goalId={goal.id} goalStatus={goal.status} />
        </div>
      </div>

      {/* Confirmation dialog for destructive actions */}
      <Dialog
        open={confirmDialog.open}
        onClose={() => setConfirmDialog((d) => ({ ...d, open: false }))}
      >
        <DialogHeader>
          <DialogTitle>Cancel this goal?</DialogTitle>
          <DialogDescription>
            This will cancel the goal and all pending tasks. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setConfirmDialog((d) => ({ ...d, open: false }))}
          >
            Keep Goal
          </Button>
          <Button
            variant="destructive"
            onClick={confirmStatusChange}
            disabled={updateStatus.isPending}
          >
            {updateStatus.isPending ? "Cancelling..." : "Yes, Cancel Goal"}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
