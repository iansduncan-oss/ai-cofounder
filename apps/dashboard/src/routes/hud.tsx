import {
  useHealth,
  useProviderHealth,
  useMonitoringStatus,
  useQueueStatus,
  useBriefing,
  useToolStats,
  usePendingTasks,
  usePendingApprovals,
} from "@/api/queries";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CardSkeleton } from "@/components/common/loading-skeleton";
import { usePageTitle } from "@/hooks/use-page-title";
import { cn } from "@/lib/utils";
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  CircleDot,
  Cpu,
  GitBranch,
  GitPullRequest,
  HardDrive,
  Layers,
  MemoryStick,
  Server,
  Shield,
  Wrench,
  XCircle,
  FileText,
} from "lucide-react";

function StatusDot({ status }: { status: "ok" | "warning" | "critical" | "unknown" }) {
  return (
    <div
      className={cn(
        "h-2.5 w-2.5 rounded-full",
        status === "ok" && "bg-emerald-500",
        status === "warning" && "bg-amber-500",
        status === "critical" && "bg-red-500",
        status === "unknown" && "bg-gray-400",
      )}
    />
  );
}

function MetricCard({
  label,
  value,
  subtext,
  icon: Icon,
  status,
}: {
  label: string;
  value: string | number;
  subtext?: string;
  icon: React.ComponentType<{ className?: string }>;
  status?: "ok" | "warning" | "critical" | "unknown";
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
        <div className="flex items-center gap-2">
          {status && <StatusDot status={status} />}
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {subtext && (
          <p className="text-xs text-muted-foreground">{subtext}</p>
        )}
      </CardContent>
    </Card>
  );
}

export function HudPage() {
  usePageTitle("HUD");

  const { data: health } = useHealth();
  const { data: providers } = useProviderHealth();
  const { data: monitoring, isLoading: monitoringLoading } = useMonitoringStatus();
  const { data: queues, isLoading: queuesLoading } = useQueueStatus();
  const { data: briefing } = useBriefing();
  const { data: toolStats } = useToolStats();
  const { data: pendingTasks } = usePendingTasks();
  const { data: approvals } = usePendingApprovals();

  const isLoading = monitoringLoading || queuesLoading;

  const allProvidersHealthy = providers?.providers.every((p) => p.available) ?? false;
  const alertCount = monitoring?.alerts?.length ?? 0;
  const criticalAlerts = monitoring?.alerts?.filter((a) => a.severity === "critical").length ?? 0;

  return (
    <div>
      <PageHeader
        title="JARVIS HUD"
        description="Real-time system health at a glance"
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : (
        <>
          {/* Top-level status cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="System"
              value={health?.status === "ok" ? "Healthy" : "Degraded"}
              subtext={health ? `Up ${Math.floor(health.uptime / 3600)}h` : "Checking..."}
              icon={Activity}
              status={health?.status === "ok" ? "ok" : "warning"}
            />
            <MetricCard
              label="LLM Providers"
              value={allProvidersHealthy ? "All Up" : "Degraded"}
              subtext={`${providers?.providers.length ?? 0} registered`}
              icon={Cpu}
              status={allProvidersHealthy ? "ok" : "warning"}
            />
            <MetricCard
              label="Alerts"
              value={alertCount}
              subtext={criticalAlerts > 0 ? `${criticalAlerts} critical` : "No critical alerts"}
              icon={alertCount > 0 ? AlertTriangle : Shield}
              status={criticalAlerts > 0 ? "critical" : alertCount > 0 ? "warning" : "ok"}
            />
            <MetricCard
              label="Queue Depth"
              value={queues?.queues?.reduce((sum, q) => sum + q.waiting + q.active, 0) ?? 0}
              subtext={`${queues?.queues?.reduce((sum, q) => sum + q.active, 0) ?? 0} active`}
              icon={Layers}
              status="ok"
            />
          </div>

          {/* Second row: Pending work */}
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Pending Tasks"
              value={pendingTasks?.length ?? 0}
              subtext="Awaiting execution"
              icon={CircleDot}
            />
            <MetricCard
              label="Pending Approvals"
              value={approvals?.length ?? 0}
              subtext={approvals && approvals.length > 0 ? "Needs attention" : "None pending"}
              icon={Shield}
              status={approvals && approvals.length > 0 ? "warning" : "ok"}
            />
            <MetricCard
              label="VPS Disk"
              value={monitoring?.vps ? `${monitoring.vps.diskUsagePercent}%` : "N/A"}
              subtext={monitoring?.vps?.uptime ?? "Not monitored"}
              icon={HardDrive}
              status={
                monitoring?.vps
                  ? monitoring.vps.diskUsagePercent > 90
                    ? "critical"
                    : monitoring.vps.diskUsagePercent > 75
                      ? "warning"
                      : "ok"
                  : "unknown"
              }
            />
            <MetricCard
              label="VPS Memory"
              value={monitoring?.vps ? `${monitoring.vps.memoryUsagePercent}%` : "N/A"}
              subtext={
                monitoring?.vps
                  ? `Load: ${monitoring.vps.cpuLoadAvg.map((l) => l.toFixed(1)).join(" / ")}`
                  : "Not monitored"
              }
              icon={MemoryStick}
              status={
                monitoring?.vps
                  ? monitoring.vps.memoryUsagePercent > 90
                    ? "critical"
                    : monitoring.vps.memoryUsagePercent > 75
                      ? "warning"
                      : "ok"
                  : "unknown"
              }
            />
          </div>

          {/* Three-column detail area */}
          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            {/* Alerts column */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <AlertTriangle className="h-4 w-4" />
                  Active Alerts
                </CardTitle>
              </CardHeader>
              <CardContent>
                {monitoring?.alerts && monitoring.alerts.length > 0 ? (
                  <div className="space-y-2">
                    {monitoring.alerts.map((alert, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2 rounded-md border p-2 text-sm"
                      >
                        <Badge
                          variant={
                            alert.severity === "critical"
                              ? "destructive"
                              : alert.severity === "warning"
                                ? "warning"
                                : "secondary"
                          }
                          className="shrink-0 text-[10px]"
                        >
                          {alert.severity}
                        </Badge>
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-muted-foreground">
                            {alert.source}
                          </p>
                          <p className="text-xs">{alert.message}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No active alerts
                  </p>
                )}
              </CardContent>
            </Card>

            {/* GitHub column */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <GitBranch className="h-4 w-4" />
                  GitHub Status
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {monitoring?.github ? (
                  <>
                    {/* CI Status */}
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                        CI Pipelines
                      </p>
                      {monitoring.github.ciStatus.length > 0 ? (
                        <div className="space-y-1.5">
                          {monitoring.github.ciStatus.map((ci, i) => (
                            <div
                              key={i}
                              className="flex items-center justify-between text-sm"
                            >
                              <span className="truncate text-xs">
                                {ci.repo.split("/").pop()} / {ci.branch}
                              </span>
                              {ci.status === "success" ? (
                                <CheckCircle className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                              ) : ci.status === "failure" ? (
                                <XCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
                              ) : (
                                <CircleDot className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">No CI data</p>
                      )}
                    </div>

                    {/* PRs */}
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                        Open PRs
                      </p>
                      {monitoring.github.openPRs.length > 0 ? (
                        <div className="space-y-1.5">
                          {monitoring.github.openPRs.slice(0, 5).map((pr, i) => (
                            <div
                              key={i}
                              className="flex items-center gap-2 text-xs"
                            >
                              <GitPullRequest className="h-3 w-3 shrink-0 text-muted-foreground" />
                              <span className="truncate">
                                #{pr.number} {pr.title}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">No open PRs</p>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    GitHub monitoring not configured
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Containers / VPS column */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <Server className="h-4 w-4" />
                  Containers
                </CardTitle>
              </CardHeader>
              <CardContent>
                {monitoring?.vps?.containers && monitoring.vps.containers.length > 0 ? (
                  <div className="space-y-1.5">
                    {monitoring.vps.containers.map((c, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between text-xs"
                      >
                        <span className="truncate">{c.name}</span>
                        <Badge
                          variant={
                            c.status.includes("Up")
                              ? "success"
                              : "destructive"
                          }
                          className="text-[10px]"
                        >
                          {c.health ?? c.status.split(" ")[0]}
                        </Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No container data
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Bottom row: Queue details + Provider health + Tool stats */}
          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            {/* Queue details */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <Layers className="h-4 w-4" />
                  Queue Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                {queues?.queues && queues.queues.length > 0 ? (
                  <div className="space-y-2">
                    {queues.queues.map((q, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="font-medium">{q.name}</span>
                        <div className="flex gap-2 text-muted-foreground">
                          <span>{q.waiting}w</span>
                          <span>{q.active}a</span>
                          <span className="text-emerald-600">{q.completed}c</span>
                          {q.failed > 0 && (
                            <span className="text-red-500">{q.failed}f</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Queue system not active
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Provider health */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <Cpu className="h-4 w-4" />
                  LLM Providers
                </CardTitle>
              </CardHeader>
              <CardContent>
                {providers?.providers && providers.providers.length > 0 ? (
                  <div className="space-y-2">
                    {providers.providers.map((p, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <StatusDot status={p.available ? "ok" : "critical"} />
                          <span className="font-medium">{p.provider}</span>
                        </div>
                        <div className="flex gap-2 text-muted-foreground">
                          <span>{Math.round(p.avgLatencyMs)}ms</span>
                          <span>{p.successCount}/{p.totalRequests}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No providers</p>
                )}
              </CardContent>
            </Card>

            {/* Tool stats */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <Wrench className="h-4 w-4" />
                  Tool Performance
                </CardTitle>
              </CardHeader>
              <CardContent>
                {toolStats?.tools && toolStats.tools.length > 0 ? (
                  <div className="space-y-2">
                    {toolStats.tools.slice(0, 8).map((t, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="truncate font-medium">{t.toolName}</span>
                        <div className="flex gap-2 text-muted-foreground">
                          <span>{Math.round(t.avgDurationMs)}ms</span>
                          <span>{t.totalExecutions}x</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No tool data</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Briefing section */}
          {briefing?.briefing && (
            <Card className="mt-6">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <FileText className="h-4 w-4" />
                  Latest Briefing
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-sm">
                  {briefing.briefing}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
