import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import { queryKeys } from "@/lib/query-keys";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { ListSkeleton } from "@/components/common/loading-skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { RelativeTime } from "@/components/common/relative-time";
import { usePageTitle } from "@/hooks/use-page-title";
import { Workflow, CheckCircle2, XCircle, Clock, AlertCircle } from "lucide-react";
import type { N8nExecution } from "@ai-cofounder/api-client";

/* ── Execution status badge ── */

const statusConfig: Record<N8nExecution["status"], { label: string; variant: BadgeProps["variant"]; icon: typeof CheckCircle2 }> = {
  success: { label: "Success", variant: "success", icon: CheckCircle2 },
  error: { label: "Error", variant: "destructive", icon: XCircle },
  waiting: { label: "Waiting", variant: "warning", icon: Clock },
  canceled: { label: "Canceled", variant: "outline", icon: AlertCircle },
};

function ExecutionStatusBadge({ status }: { status: N8nExecution["status"] }) {
  const config = statusConfig[status] ?? { label: status, variant: "outline" as const, icon: AlertCircle };
  const Icon = config.icon;
  return (
    <Badge variant={config.variant} className="flex items-center gap-1">
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}

/* ── Duration formatter ── */

function formatDuration(startIso: string, stopIso: string | null): string {
  if (!stopIso) return "Running";
  const ms = new Date(stopIso).getTime() - new Date(startIso).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/* ── N8nWorkflowsPage ── */

export function N8nWorkflowsPage() {
  usePageTitle("N8n Workflows");

  const {
    data: workflowsData,
    isLoading: workflowsLoading,
  } = useQuery({
    queryKey: queryKeys.n8n.workflows,
    queryFn: () => apiClient.listN8nWorkflows(),
  });

  const {
    data: executionsData,
    isLoading: executionsLoading,
  } = useQuery({
    queryKey: queryKeys.n8n.executions(),
    queryFn: () => apiClient.listN8nExecutions({ limit: 50 }),
    refetchInterval: 30_000,
  });

  const workflows = workflowsData ?? [];
  const executions = executionsData?.data ?? [];

  return (
    <div>
      <PageHeader
        title="N8n Workflows"
        description="Registered workflows and recent execution history"
      />

      {/* Workflows section */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Registered Workflows</h2>

        {workflowsLoading ? (
          <ListSkeleton rows={2} />
        ) : workflows.length === 0 ? (
          <EmptyState
            title="No workflows registered"
            description="Register n8n workflows via the API to see them here."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {workflows.map((wf) => (
              <Card key={wf.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Workflow className="h-4 w-4 shrink-0 text-primary" />
                      <span className="truncate text-sm font-medium">{wf.name}</span>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Badge variant={wf.isActive ? "success" : "secondary"} className="text-xs">
                        {wf.isActive ? "Active" : "Inactive"}
                      </Badge>
                      <Badge variant="outline" className="text-xs capitalize">
                        {wf.direction}
                      </Badge>
                    </div>
                  </div>
                  {wf.description && (
                    <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{wf.description}</p>
                  )}
                  {wf.webhookUrl && (
                    <p className="mt-2 truncate text-[10px] text-muted-foreground font-mono">
                      {wf.webhookUrl}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Execution history section */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Recent Executions</h2>
        <p className="mb-3 text-xs text-muted-foreground">Auto-refreshing every 30s</p>

        {executionsLoading ? (
          <ListSkeleton rows={4} />
        ) : executions.length === 0 ? (
          <EmptyState
            title="No executions yet"
            description="Workflow executions will appear here once workflows are triggered."
          />
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Workflow</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Mode</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Started</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Duration</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {executions.map((exec) => (
                      <tr key={exec.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <ExecutionStatusBadge status={exec.status} />
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                          {exec.workflowId}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs capitalize text-muted-foreground">{exec.mode}</span>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <RelativeTime date={exec.startedAt} />
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {formatDuration(exec.startedAt, exec.stoppedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
