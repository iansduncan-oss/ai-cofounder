import { useState } from "react";
import { useSubagentRuns } from "@/api/queries";
import { useCancelSubagentRun } from "@/api/mutations";
import { PageHeader } from "@/components/layout/page-header";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListSkeleton } from "@/components/common/loading-skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { RelativeTime } from "@/components/common/relative-time";
import { usePageTitle } from "@/hooks/use-page-title";
import { AlertTriangle, XCircle, ChevronDown, ChevronUp, Boxes, Activity, Clock, Zap } from "lucide-react";
import type { SubagentRun, SubagentRunStatus } from "@ai-cofounder/api-client";

const statusConfig: Record<SubagentRunStatus, { label: string; variant: BadgeProps["variant"] }> = {
  completed: { label: "Completed", variant: "success" },
  failed: { label: "Failed", variant: "destructive" },
  running: { label: "Running", variant: "default" },
  queued: { label: "Queued", variant: "warning" },
  cancelled: { label: "Cancelled", variant: "secondary" },
};

function StatusBadge({ status }: { status: SubagentRunStatus }) {
  const config = statusConfig[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "-";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function SubagentsPage() {
  usePageTitle("Subagents");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading, error } = useSubagentRuns(statusFilter);
  const cancelMutation = useCancelSubagentRun();

  const runs = data?.data ?? [];

  // Stats
  const totalRuns = data?.total ?? runs.length;
  const runningCount = runs.filter((r) => r.status === "running").length;
  const completedCount = runs.filter((r) => r.status === "completed").length;
  const failedCount = runs.filter((r) => r.status === "failed").length;
  const successRate =
    completedCount + failedCount > 0
      ? ((completedCount / (completedCount + failedCount)) * 100).toFixed(1)
      : "-";
  const avgDuration =
    runs.filter((r) => r.durationMs != null).length > 0
      ? Math.round(
          runs.filter((r) => r.durationMs != null).reduce((sum, r) => sum + (r.durationMs ?? 0), 0) /
            runs.filter((r) => r.durationMs != null).length,
        )
      : null;

  return (
    <div>
      <PageHeader
        title="Subagent Runs"
        description="Inspect specialist agent execution runs"
        actions={
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-40"
          >
            <option value="all">All statuses</option>
            <option value="queued">Queued</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        }
      />

      {error ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <AlertTriangle className="mb-3 h-8 w-8 text-destructive" />
          <p className="text-sm font-medium">Failed to load subagent runs</p>
          <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>
        </div>
      ) : isLoading ? (
        <ListSkeleton rows={4} />
      ) : runs.length === 0 ? (
        <EmptyState
          icon={<Boxes className="h-10 w-10" />}
          title="No subagent runs"
          description={
            statusFilter !== "all"
              ? "No runs match the selected filter."
              : "Subagent runs will appear here when the orchestrator spawns specialist agents."
          }
        />
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Boxes className="h-3.5 w-3.5" />
                  Total Runs
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{totalRuns}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Activity className="h-3.5 w-3.5" />
                  Running
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{runningCount}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5" />
                  Success Rate
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{successRate}{successRate !== "-" && "%"}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  Avg Duration
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatDuration(avgDuration)}</p>
              </CardContent>
            </Card>
          </div>

          {/* Table */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-4 py-3 font-medium w-8" />
                      <th className="px-4 py-3 font-medium">Title</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Model</th>
                      <th className="px-4 py-3 font-medium">Provider</th>
                      <th className="px-4 py-3 font-medium text-center">Rounds</th>
                      <th className="px-4 py-3 font-medium text-right">Tokens</th>
                      <th className="px-4 py-3 font-medium text-right">Duration</th>
                      <th className="px-4 py-3 font-medium">Created</th>
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {runs.map((run) => (
                      <RunRow
                        key={run.id}
                        run={run}
                        expanded={expandedId === run.id}
                        onToggle={() => setExpandedId(expandedId === run.id ? null : run.id)}
                        onCancel={() => cancelMutation.mutate(run.id)}
                        cancelPending={cancelMutation.isPending}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function RunRow({
  run,
  expanded,
  onToggle,
  onCancel,
  cancelPending,
}: {
  run: SubagentRun;
  expanded: boolean;
  onToggle: () => void;
  onCancel: () => void;
  cancelPending: boolean;
}) {
  const canCancel = run.status === "running" || run.status === "queued";
  const modelName = run.model
    ? run.model.length > 20
      ? run.model.slice(0, 18) + "..."
      : run.model
    : "-";

  return (
    <>
      <tr
        className="hover:bg-accent/50 transition-colors cursor-pointer"
        onClick={onToggle}
      >
        <td className="px-4 py-3">
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </td>
        <td className="px-4 py-3 font-medium max-w-xs truncate" title={run.title}>
          {run.title}
        </td>
        <td className="px-4 py-3">
          <StatusBadge status={run.status} />
        </td>
        <td className="px-4 py-3 text-muted-foreground text-xs" title={run.model ?? undefined}>
          {modelName}
        </td>
        <td className="px-4 py-3 text-muted-foreground text-xs">{run.provider ?? "-"}</td>
        <td className="px-4 py-3 text-center tabular-nums">{run.toolRounds}</td>
        <td className="px-4 py-3 text-right tabular-nums">{formatTokens(run.tokens)}</td>
        <td className="px-4 py-3 text-right tabular-nums">{formatDuration(run.durationMs)}</td>
        <td className="px-4 py-3 text-muted-foreground">
          <RelativeTime date={run.createdAt} />
        </td>
        <td className="px-4 py-3 text-right">
          {canCancel && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onCancel();
              }}
              disabled={cancelPending}
              title="Cancel"
              className="text-destructive hover:text-destructive"
            >
              <XCircle className="h-3.5 w-3.5" />
            </Button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={10} className="px-4 py-4 bg-muted/30">
            <div className="space-y-3 text-sm">
              <div>
                <span className="font-medium text-muted-foreground">Instruction:</span>
                <p className="mt-1 whitespace-pre-wrap text-xs bg-muted rounded-md p-3">{run.instruction}</p>
              </div>
              {run.output && (
                <div>
                  <span className="font-medium text-muted-foreground">Output:</span>
                  <p className="mt-1 whitespace-pre-wrap text-xs bg-muted rounded-md p-3 max-h-48 overflow-y-auto">
                    {run.output}
                  </p>
                </div>
              )}
              {run.error && (
                <div>
                  <span className="font-medium text-destructive">Error:</span>
                  <p className="mt-1 whitespace-pre-wrap text-xs bg-destructive/10 text-destructive rounded-md p-3">
                    {run.error}
                  </p>
                </div>
              )}
              {run.toolsUsed && run.toolsUsed.length > 0 && (
                <div>
                  <span className="font-medium text-muted-foreground">Tools Used:</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {run.toolsUsed.map((tool) => (
                      <Badge key={tool} variant="outline" className="text-[10px]">
                        {tool}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
