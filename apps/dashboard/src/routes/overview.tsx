import { useHealth, usePendingApprovals, usePendingTasks, useUsage } from "@/api/queries";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CardSkeleton } from "@/components/common/loading-skeleton";
import { TaskStatusBadge } from "@/components/common/status-badge";
import { RelativeTime } from "@/components/common/relative-time";
import { usePageTitle } from "@/hooks/use-page-title";
import { Target, ShieldCheck, Zap, Activity, AlertTriangle } from "lucide-react";
import { Link } from "react-router";

export function OverviewPage() {
  usePageTitle("Overview");

  const { data: health } = useHealth();
  const { data: approvals, isLoading: approvalsLoading, error: approvalsError } = usePendingApprovals();
  const { data: pendingTasks, isLoading: tasksLoading, error: tasksError } = usePendingTasks();
  const { data: usage, isLoading: usageLoading } = useUsage("today");

  const isLoading = approvalsLoading || tasksLoading || usageLoading;
  const hasError = approvalsError || tasksError;

  if (hasError) {
    return (
      <div>
        <PageHeader title="Overview" description="System summary at a glance" />
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <AlertTriangle className="mb-3 h-8 w-8 text-destructive" />
          <p className="text-sm font-medium">Failed to load dashboard data</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {(approvalsError || tasksError)?.message}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Overview"
        description="System summary at a glance"
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Link to="/dashboard/goals">
            <Card className="transition-all hover:shadow-md hover:-translate-y-0.5 cursor-pointer">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">
                  Pending Tasks
                </CardTitle>
                <Target className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {pendingTasks?.length ?? 0}
                </div>
                <p className="text-xs text-muted-foreground">
                  Awaiting execution
                </p>
              </CardContent>
            </Card>
          </Link>

          <Link to="/dashboard/approvals">
            <Card className="transition-all hover:shadow-md hover:-translate-y-0.5 cursor-pointer">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">
                  Pending Approvals
                </CardTitle>
                <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {approvals?.length ?? 0}
                </div>
                <p className="text-xs text-muted-foreground">
                  Require action
                </p>
              </CardContent>
            </Card>
          </Link>

          <Card className="transition-all hover:shadow-md hover:-translate-y-0.5">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">
                Today&apos;s Tokens
              </CardTitle>
              <Zap className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {usage
                  ? Math.round(
                      (usage.totalInputTokens + usage.totalOutputTokens) / 1000,
                    ) + "k"
                  : "0"}
              </div>
              <p className="text-xs text-muted-foreground">
                ${usage?.totalCostUsd?.toFixed(2) ?? "0.00"} estimated
              </p>
            </CardContent>
          </Card>

          <Card className="transition-all hover:shadow-md hover:-translate-y-0.5">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">
                System Status
              </CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {health?.status === "ok" ? "Healthy" : "Degraded"}
              </div>
              <p className="text-xs text-muted-foreground">
                {health
                  ? `Up ${Math.floor(health.uptime / 3600)}h`
                  : "Checking..."}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="mt-8">
        <h2 className="mb-4 text-lg font-semibold">Recent Tasks</h2>
        {pendingTasks && pendingTasks.length > 0 ? (
          <div className="space-y-2">
            {pendingTasks.slice(0, 10).map((task) => (
              <div
                key={task.id}
                className="flex items-center justify-between rounded-lg border bg-card p-3 transition-colors hover:bg-accent"
              >
                <div className="flex-1">
                  <p className="text-sm font-medium">{task.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {task.assignedAgent && `${task.assignedAgent} · `}
                    <RelativeTime date={task.createdAt} />
                  </p>
                </div>
                <TaskStatusBadge status={task.status} />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No pending tasks</p>
        )}
      </div>
    </div>
  );
}
