import { useHealth, usePendingApprovals, usePendingTasks, useUsage, useProviderHealth, useGoalAnalytics } from "@/api/queries";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CardSkeleton } from "@/components/common/loading-skeleton";
import { TaskStatusBadge } from "@/components/common/status-badge";
import { RelativeTime } from "@/components/common/relative-time";
import { usePageTitle } from "@/hooks/use-page-title";
import { Target, ShieldCheck, Zap, Activity, AlertTriangle, CheckCircle, XCircle, Clock } from "lucide-react";
import { Link } from "react-router";

export function OverviewPage() {
  usePageTitle("Overview");

  const { data: health } = useHealth();
  const { data: approvals, isLoading: approvalsLoading, error: approvalsError } = usePendingApprovals();
  const { data: pendingTasks, isLoading: tasksLoading, error: tasksError } = usePendingTasks();
  const { data: usage, isLoading: usageLoading } = useUsage("today");
  const { data: providerHealthData } = useProviderHealth();
  const { data: goalAnalytics } = useGoalAnalytics();

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

      {/* Goal Performance + Provider Health */}
      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        {/* Goal Performance */}
        {goalAnalytics && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Target className="h-4 w-4" />
                Goal Performance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <div className="text-center">
                  <p className="text-lg font-bold">{goalAnalytics.totalGoals}</p>
                  <p className="text-xs text-muted-foreground">Total</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold">{goalAnalytics.completionRate}%</p>
                  <p className="text-xs text-muted-foreground">Completed</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold">{goalAnalytics.taskSuccessRate}%</p>
                  <p className="text-xs text-muted-foreground">Task Success</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(goalAnalytics.byStatus).map(([status, count]) => (
                  <Badge key={status} variant="outline" className="text-xs">
                    {status}: {count}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Provider Health */}
        {providerHealthData?.providers && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Activity className="h-4 w-4" />
                Provider Health
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {providerHealthData.providers.map((p) => (
                  <div key={p.provider} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      {p.available ? (
                        <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-destructive" />
                      )}
                      <span className="font-medium">{p.provider}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{p.totalRequests} req</span>
                      <span>{p.avgLatencyMs.toFixed(0)}ms</span>
                      {p.errorCount > 0 && (
                        <span className="text-destructive">{p.errorCount} err</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
