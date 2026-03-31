import { useQueryClient } from "@tanstack/react-query";
import { useRoutingStats } from "@/api/queries";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListSkeleton } from "@/components/common/loading-skeleton";
import { usePageTitle } from "@/hooks/use-page-title";
import { queryKeys } from "@/lib/query-keys";
import {
  Route,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ROLE_COLORS: Record<string, string> = {
  researcher: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  coder: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  reviewer: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  planner: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
  debugger: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  doc_writer: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
};

function formatDuration(ms: number | null): string {
  if (ms == null) return "--";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function TrendIcon({ overall, recent }: { overall: number; recent: number | null }) {
  if (recent == null) return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  const diff = recent - overall;
  if (diff > 0.05) return <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />;
  if (diff < -0.05) return <TrendingDown className="h-3.5 w-3.5 text-red-600" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

function SuccessRateCell({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100);
  return (
    <span
      className={cn(
        "font-semibold",
        pct >= 80 ? "text-emerald-600" : pct >= 50 ? "text-amber-600" : "text-red-600",
      )}
    >
      {pct}%
    </span>
  );
}

export function RoutingPage() {
  usePageTitle("Adaptive Routing");
  const queryClient = useQueryClient();
  const { data, isLoading, isFetching } = useRoutingStats();

  const agents = data?.agentPerformance ?? [];
  const decisions = data?.recentDecisions ?? [];

  const handleRefresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.routing.stats });
  };

  return (
    <div>
      <PageHeader
        title="Adaptive Routing"
        description="Agent performance scores and routing decision history"
        actions={
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isFetching}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isFetching && "animate-spin")} />
            Refresh
          </Button>
        }
      />

      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : (
        <>
          {/* Summary cards */}
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Total Decisions</p>
                <p className="text-2xl font-bold">{data?.totalDecisions ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Override Rate</p>
                <p className="text-2xl font-bold">
                  {data ? `${Math.round(data.overrideRate * 100)}%` : "0%"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Total Overrides</p>
                <p className="text-2xl font-bold">{data?.totalOverrides ?? 0}</p>
              </CardContent>
            </Card>
          </div>

          {/* Agent performance table */}
          <h2 className="mb-3 text-lg font-semibold">Agent Performance</h2>
          {agents.length === 0 ? (
            <Card className="mb-6">
              <CardContent className="py-8 text-center">
                <Route className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  No agent performance data available yet
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card className="mb-6 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-4 py-2.5 text-left font-medium">Agent</th>
                      <th className="px-4 py-2.5 text-right font-medium">Tasks</th>
                      <th className="px-4 py-2.5 text-right font-medium">Success</th>
                      <th className="px-4 py-2.5 text-right font-medium">Avg Speed</th>
                      <th className="px-4 py-2.5 text-right font-medium">Score</th>
                      <th className="px-4 py-2.5 text-center font-medium">Trend</th>
                      <th className="px-4 py-2.5 text-center font-medium">Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agents.map((agent) => (
                      <tr key={agent.agent} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-2.5">
                          <Badge className={ROLE_COLORS[agent.agent] ?? ""}>
                            {agent.agent}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {agent.totalTasks}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <SuccessRateCell rate={agent.overallSuccessRate} />
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                          {formatDuration(agent.avgDurationMs)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                          {agent.score.toFixed(3)}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <TrendIcon
                            overall={agent.overallSuccessRate}
                            recent={agent.recentSuccessRate}
                          />
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {agent.hasSufficientData ? (
                            <span className="text-xs text-emerald-600">OK</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                              <AlertTriangle className="h-3 w-3" />
                              Low
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Recent routing decisions */}
          <h2 className="mb-3 text-lg font-semibold">Recent Decisions</h2>
          {decisions.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <Route className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No routing decisions recorded yet</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-4 py-2.5 text-left font-medium">Task</th>
                      <th className="px-4 py-2.5 text-left font-medium">Original</th>
                      <th className="px-4 py-2.5 text-left font-medium">Recommended</th>
                      <th className="px-4 py-2.5 text-right font-medium">Confidence</th>
                      <th className="px-4 py-2.5 text-center font-medium">Override</th>
                      <th className="px-4 py-2.5 text-right font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {decisions.map((d) => (
                      <tr key={d.taskId} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="max-w-[160px] truncate px-4 py-2.5 font-mono text-xs">
                          {d.taskId}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge variant="outline" className="text-xs">
                            {d.originalAgent}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge className={cn("text-xs", ROLE_COLORS[d.recommendedAgent] ?? "")}>
                            {d.recommendedAgent}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                          {(d.confidence * 100).toFixed(1)}%
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {d.overridden ? (
                            <Badge variant="destructive" className="text-xs">Yes</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">No</Badge>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                          {new Date(d.timestamp).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
