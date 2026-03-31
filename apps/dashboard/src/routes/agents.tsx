import { useAgentCapabilities, useGoalAnalytics, useToolStats } from "@/api/queries";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ListSkeleton } from "@/components/common/loading-skeleton";
import { usePageTitle } from "@/hooks/use-page-title";
import { Bot, CheckCircle, XCircle, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

const ROLE_COLORS: Record<string, string> = {
  orchestrator: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  researcher: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  coder: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  reviewer: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  planner: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
  debugger: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  doc_writer: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
  verifier: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
};

export function AgentsPage() {
  usePageTitle("Agent Roles");
  const { data, isLoading } = useAgentCapabilities();
  const { data: goalAnalytics } = useGoalAnalytics();
  const { data: toolStatsData } = useToolStats();
  const agents = data?.agents ?? [];
  const tasksByAgent = goalAnalytics?.tasksByAgent ?? [];
  const toolStats = toolStatsData?.tools ?? [];

  // Build per-agent stats lookup
  const agentTaskStats = new Map(tasksByAgent.map((a) => [a.agent, a]));

  // Build per-agent tool performance (match agent tools to tool stats)
  const getAgentToolPerformance = (agentTools: string[]) => {
    const matched = toolStats.filter((t) => agentTools.includes(t.toolName));
    if (matched.length === 0) return null;
    const totalExec = matched.reduce((s, t) => s + t.totalExecutions, 0);
    const totalSuccess = matched.reduce((s, t) => s + t.successCount, 0);
    const avgLatency = matched.reduce((s, t) => s + t.avgDurationMs, 0) / matched.length;
    return {
      totalExecutions: totalExec,
      successRate: totalExec > 0 ? Math.round((totalSuccess / totalExec) * 100) : 0,
      avgLatencyMs: Math.round(avgLatency),
    };
  };

  return (
    <div>
      <PageHeader title="Agent Roles" description="Specialist agents, their tools, and capabilities" />

      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : agents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Bot className="mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">No agent roles configured</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {agents.map((a) => {
            const taskStats = agentTaskStats.get(a.role);
            const toolPerf = getAgentToolPerformance(a.tools);
            const taskSuccessRate = taskStats && taskStats.total > 0
              ? Math.round((taskStats.completed / taskStats.total) * 100)
              : null;

            return (
              <Card key={a.role}>
                <CardContent className="pt-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Bot className="h-4 w-4 text-muted-foreground" />
                    <Badge className={ROLE_COLORS[a.role] ?? ""}>
                      {a.role}
                    </Badge>
                  </div>
                  <p className="mb-3 text-sm text-muted-foreground">{a.description}</p>

                  {/* Performance stats */}
                  {(taskStats || toolPerf) && (
                    <div className="mb-3 grid grid-cols-3 gap-2 rounded-md bg-muted/50 p-2">
                      {taskStats ? (
                        <>
                          <div className="text-center">
                            <p className="text-sm font-bold">{taskStats.total}</p>
                            <p className="text-[10px] text-muted-foreground">Tasks</p>
                          </div>
                          <div className="text-center">
                            <p className={cn("text-sm font-bold", taskSuccessRate != null && taskSuccessRate >= 80 ? "text-emerald-600" : taskSuccessRate != null && taskSuccessRate >= 50 ? "text-amber-600" : "text-red-600")}>
                              {taskSuccessRate ?? 0}%
                            </p>
                            <p className="text-[10px] text-muted-foreground">Success</p>
                          </div>
                          <div className="text-center">
                            <p className="text-sm font-bold text-destructive">{taskStats.failed}</p>
                            <p className="text-[10px] text-muted-foreground">Failed</p>
                          </div>
                        </>
                      ) : toolPerf ? (
                        <>
                          <div className="text-center">
                            <p className="text-sm font-bold">{toolPerf.totalExecutions}</p>
                            <p className="text-[10px] text-muted-foreground">Tool Calls</p>
                          </div>
                          <div className="text-center">
                            <p className={cn("text-sm font-bold", toolPerf.successRate >= 90 ? "text-emerald-600" : "text-amber-600")}>
                              {toolPerf.successRate}%
                            </p>
                            <p className="text-[10px] text-muted-foreground">Success</p>
                          </div>
                          <div className="text-center">
                            <p className="text-sm font-bold">{toolPerf.avgLatencyMs}ms</p>
                            <p className="text-[10px] text-muted-foreground">Avg Latency</p>
                          </div>
                        </>
                      ) : null}
                    </div>
                  )}

                  {a.specialties.length > 0 && (
                    <div className="mb-3">
                      <p className="mb-1 text-xs font-medium text-muted-foreground">Specialties</p>
                      <div className="flex flex-wrap gap-1">
                        {a.specialties.map((s) => (
                          <Badge key={s} variant="secondary" className="text-xs">
                            {s}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {a.tools.length > 0 && (
                    <div>
                      <p className="mb-1 text-xs font-medium text-muted-foreground">
                        Tools ({a.tools.length})
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {a.tools.map((t) => {
                          const stat = toolStats.find((ts) => ts.toolName === t);
                          return (
                            <Badge
                              key={t}
                              variant="outline"
                              className={cn("text-xs", stat && stat.errorCount > 0 && "border-amber-500/50")}
                              title={stat ? `${stat.totalExecutions} calls, ${stat.successCount} ok, ${stat.errorCount} err` : undefined}
                            >
                              {t}
                              {stat && stat.totalExecutions > 0 && (
                                <span className="ml-1 opacity-50">({stat.totalExecutions})</span>
                              )}
                            </Badge>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
