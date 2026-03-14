import { useState } from "react";
import {
  useGoals,
  useUsage,
  useToolStats,
  useProviderHealth,
  useDashboardSummary,
} from "@/api/queries";
import { PageHeader } from "@/components/layout/page-header";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CardSkeleton } from "@/components/common/loading-skeleton";
import { usePageTitle } from "@/hooks/use-page-title";
import { AlertTriangle, Target, TrendingUp, DollarSign, Cpu } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

const COLORS = ["#3b82f6", "#8b5cf6", "#06b6d4", "#f59e0b", "#ef4444", "#10b981", "#f97316", "#ec4899"];

const tooltipStyle = {
  backgroundColor: "var(--color-card)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.375rem",
  fontSize: 12,
};

type Period = "today" | "week" | "month" | "all";

export function AnalyticsPage() {
  usePageTitle("Analytics");
  const [period, setPeriod] = useState<Period>("week");

  const conversationId = localStorage.getItem("ai-cofounder-conversation-id") ?? "";
  const { data: goalsData } = useGoals(conversationId);
  const { data: summary, isLoading: summaryLoading, error: summaryError } = useDashboardSummary();
  const { data: usage } = useUsage(period);
  const { data: toolStatsData } = useToolStats();
  const { data: providerHealthData } = useProviderHealth();

  const goals = goalsData?.data ?? [];
  const tools = toolStatsData?.tools ?? [];
  const providers = providerHealthData?.providers ?? [];

  // Goal outcome pie
  const goalStatusCounts: Record<string, number> = {};
  for (const g of goals) {
    goalStatusCounts[g.status] = (goalStatusCounts[g.status] ?? 0) + 1;
  }
  const goalPieData = Object.entries(goalStatusCounts).map(([name, value]) => ({ name, value }));

  const completedGoals = goalStatusCounts["completed"] ?? 0;
  const totalGoals = goals.length;
  const successRate = totalGoals > 0 ? ((completedGoals / totalGoals) * 100).toFixed(1) : "0";

  // Cost by provider from usage data
  const costByProvider = usage
    ? Object.entries(usage.byProvider).map(([name, d]) => ({
        name,
        cost: d.costUsd,
        requests: d.requests,
      }))
    : [];

  // Tool performance (success vs error)
  const toolPerformanceData = tools.slice(0, 12).map((t) => ({
    name: t.toolName.length > 18 ? t.toolName.slice(0, 16) + "..." : t.toolName,
    success: t.successCount,
    error: t.errorCount,
  }));

  // Agent performance from usage
  const agentPerformanceData = usage
    ? Object.entries(usage.byAgent).map(([name, d]) => ({
        name,
        cost: d.costUsd,
        requests: d.requests,
      }))
    : [];

  // Provider reliability
  const providerReliabilityData = providers.map((p) => ({
    name: p.provider,
    successRate: p.totalRequests > 0 ? (p.successCount / p.totalRequests) * 100 : 0,
    avgLatency: p.avgLatencyMs,
  }));

  // Tool latency (avg vs p95)
  const toolLatencyData = tools
    .filter((t) => t.avgDurationMs > 0)
    .slice(0, 12)
    .map((t) => ({
      name: t.toolName.length > 18 ? t.toolName.slice(0, 16) + "..." : t.toolName,
      avg: Math.round(t.avgDurationMs),
      p95: Math.round(t.p95DurationMs),
    }));

  const avgCostPerGoal =
    summary && completedGoals > 0
      ? (summary.costs.month / completedGoals).toFixed(4)
      : "0.00";

  return (
    <div>
      <PageHeader
        title="Analytics"
        description="Goal success rates, agent performance, and cost trends"
        actions={
          <Select
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            className="w-32"
          >
            <option value="today">Today</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
            <option value="all">All Time</option>
          </Select>
        }
      />

      {summaryError ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <AlertTriangle className="mb-3 h-8 w-8 text-destructive" />
          <p className="text-sm font-medium">Failed to load analytics</p>
          <p className="mt-1 text-xs text-muted-foreground">{summaryError.message}</p>
        </div>
      ) : summaryLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <>
          {/* Summary stat cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Target className="h-3.5 w-3.5" />
                  Goals Completed
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{completedGoals}</p>
                <p className="text-xs text-muted-foreground mt-1">of {totalGoals} total</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5" />
                  Success Rate
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{successRate}%</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <DollarSign className="h-3.5 w-3.5" />
                  Avg Cost / Goal
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">${avgCostPerGoal}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Cpu className="h-3.5 w-3.5" />
                  Active Providers
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{providers.filter((p) => p.available).length}</p>
                <p className="text-xs text-muted-foreground mt-1">{providers.length} configured</p>
              </CardContent>
            </Card>
          </div>

          {/* Charts */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Goal outcomes pie */}
            {goalPieData.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Goal Outcomes</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie
                        data={goalPieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        label={({ name, value }) => `${name}: ${value}`}
                        labelLine={false}
                      >
                        {goalPieData.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Cost by provider */}
            {costByProvider.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Cost by Provider ({period})</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={costByProvider}>
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v.toFixed(3)}`} />
                      <Tooltip
                        formatter={(value) => `$${Number(value).toFixed(4)}`}
                        contentStyle={tooltipStyle}
                      />
                      <Bar dataKey="cost" name="Cost" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Tool execution performance */}
            {toolPerformanceData.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Tool Execution Performance</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={toolPerformanceData}>
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={60} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="success" name="Success" fill="#10b981" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="error" name="Error" fill="#ef4444" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Agent performance */}
            {agentPerformanceData.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Agent Performance ({period})</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={agentPerformanceData}>
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v.toFixed(3)}`} />
                      <Tooltip
                        formatter={(value, name) =>
                          name === "cost" ? `$${Number(value).toFixed(4)}` : value
                        }
                        contentStyle={tooltipStyle}
                      />
                      <Bar dataKey="cost" name="Cost" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="requests" name="Requests" fill="#06b6d4" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Provider reliability */}
            {providerReliabilityData.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Provider Reliability</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={providerReliabilityData}>
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
                      <Tooltip
                        formatter={(value, name) =>
                          name === "successRate" ? `${Number(value).toFixed(1)}%` : `${Number(value).toFixed(0)}ms`
                        }
                        contentStyle={tooltipStyle}
                      />
                      <Bar dataKey="successRate" name="Success Rate" fill="#10b981" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Tool latency (avg vs p95) */}
            {toolLatencyData.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Tool Latency (ms)</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={toolLatencyData}>
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={60} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}ms`} />
                      <Tooltip
                        formatter={(value) => `${value}ms`}
                        contentStyle={tooltipStyle}
                      />
                      <Bar dataKey="avg" name="Avg" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="p95" name="P95" fill="#ef4444" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}
