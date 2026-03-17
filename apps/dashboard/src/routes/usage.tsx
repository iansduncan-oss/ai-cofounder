import { useState } from "react";
import { useUsage, useProviderHealth, useDailyCost, useBudgetStatus, useTopExpensiveGoals } from "@/api/queries";
import { PageHeader } from "@/components/layout/page-header";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CardSkeleton } from "@/components/common/loading-skeleton";
import { usePageTitle } from "@/hooks/use-page-title";
import { AlertTriangle, Activity, DollarSign, Cpu, Zap, TrendingDown, Target } from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  CartesianGrid,
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

type Period = "today" | "week" | "month" | "all";

export function UsagePage() {
  usePageTitle("Usage");
  const [period, setPeriod] = useState<Period>("today");
  const { data: usage, isLoading, error } = useUsage(period);
  const { data: providerHealthData } = useProviderHealth();
  const { data: dailyData } = useDailyCost(30);
  const { data: budgetData } = useBudgetStatus();
  const { data: topGoals } = useTopExpensiveGoals(10);

  const formatTokens = (n: number) =>
    n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)}M`
      : n >= 1_000
        ? `${(n / 1_000).toFixed(1)}K`
        : String(n);

  const byProviderData = usage
    ? Object.entries(usage.byProvider).map(([name, data]) => ({
        name,
        input: data.inputTokens,
        output: data.outputTokens,
        cost: data.costUsd,
        requests: data.requests,
      }))
    : [];

  const byModelData = usage
    ? Object.entries(usage.byModel).map(([name, data]) => ({
        name: name.length > 20 ? name.slice(0, 18) + "..." : name,
        input: data.inputTokens,
        output: data.outputTokens,
        cost: data.costUsd,
      }))
    : [];

  const byAgentData = usage
    ? Object.entries(usage.byAgent).map(([name, data]) => ({
        name,
        cost: data.costUsd,
        requests: data.requests,
      }))
    : [];

  const costPieData = usage
    ? Object.entries(usage.byProvider)
        .map(([name, data]) => ({ name, value: data.costUsd }))
        .filter((d) => d.value > 0)
    : [];

  return (
    <div>
      <PageHeader
        title="Usage"
        description="Token usage and cost breakdown"
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

      {error ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <AlertTriangle className="mb-3 h-8 w-8 text-destructive" />
          <p className="text-sm font-medium">Failed to load usage data</p>
          <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>
        </div>
      ) : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : usage ? (
        <>
          {/* Summary cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5" />
                  Total Tokens
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {formatTokens(usage.totalInputTokens + usage.totalOutputTokens)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatTokens(usage.totalInputTokens)} in / {formatTokens(usage.totalOutputTokens)} out
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <DollarSign className="h-3.5 w-3.5" />
                  Total Cost
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  ${usage.totalCostUsd.toFixed(4)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Activity className="h-3.5 w-3.5" />
                  Requests
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{usage.requestCount}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Cpu className="h-3.5 w-3.5" />
                  Providers
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {providerHealthData?.providers.filter((p) => p.available).length ?? 0}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {providerHealthData?.providers.length ?? 0} configured
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Daily Cost Trend */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-sm">Daily Cost Trend (30 Days)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={dailyData?.days ?? []}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v: string) => {
                      const parts = v.split("-");
                      return `${parts[1]}/${parts[2]}`;
                    }}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => "$" + Number(v).toFixed(3)}
                  />
                  <Tooltip
                    formatter={(value) => ["$" + Number(value).toFixed(4), "Cost"]}
                    contentStyle={{
                      backgroundColor: "var(--color-card)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "0.375rem",
                      fontSize: 12,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="costUsd"
                    stroke="#3b82f6"
                    dot={false}
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Budget Gauges */}
          <div className="grid gap-4 sm:grid-cols-2 mb-6">
            {/* Daily Budget */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Daily Budget</CardTitle>
              </CardHeader>
              <CardContent>
                {budgetData?.daily.limitUsd === 0 ? (
                  <p className="text-sm text-muted-foreground">No limit configured</p>
                ) : (
                  <>
                    <p className="text-sm mb-2">
                      ${budgetData?.daily.spentUsd.toFixed(4) ?? "0.0000"} / ${budgetData?.daily.limitUsd.toFixed(2) ?? "0.00"}
                    </p>
                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          (budgetData?.daily.percentUsed ?? 0) > 100
                            ? "bg-red-500"
                            : (budgetData?.daily.percentUsed ?? 0) > 90
                              ? "bg-yellow-500"
                              : "bg-blue-500"
                        }`}
                        style={{
                          width: `${Math.min(budgetData?.daily.percentUsed ?? 0, 100)}%`,
                        }}
                      />
                    </div>
                    {budgetData?.daily.percentUsed != null && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {budgetData.daily.percentUsed.toFixed(1)}% used
                      </p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Weekly Budget */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Weekly Budget</CardTitle>
              </CardHeader>
              <CardContent>
                {budgetData?.weekly.limitUsd === 0 ? (
                  <p className="text-sm text-muted-foreground">No limit configured</p>
                ) : (
                  <>
                    <p className="text-sm mb-2">
                      ${budgetData?.weekly.spentUsd.toFixed(4) ?? "0.0000"} / ${budgetData?.weekly.limitUsd.toFixed(2) ?? "0.00"}
                    </p>
                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          (budgetData?.weekly.percentUsed ?? 0) > 100
                            ? "bg-red-500"
                            : (budgetData?.weekly.percentUsed ?? 0) > 90
                              ? "bg-yellow-500"
                              : "bg-blue-500"
                        }`}
                        style={{
                          width: `${Math.min(budgetData?.weekly.percentUsed ?? 0, 100)}%`,
                        }}
                      />
                    </div>
                    {budgetData?.weekly.percentUsed != null && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {budgetData.weekly.percentUsed.toFixed(1)}% used
                      </p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Optimization Suggestions */}
          {budgetData?.optimizationSuggestions &&
            budgetData.optimizationSuggestions.length > 0 &&
            !budgetData.optimizationSuggestions.every((s) =>
              s.startsWith("No optimization opportunities detected"),
            ) && (
              <Card className="mb-6">
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-1.5">
                    <TrendingDown className="h-3.5 w-3.5" />
                    Cost Optimization Suggestions
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {budgetData.optimizationSuggestions.map((suggestion, i) => (
                      <li key={i} className="text-sm text-muted-foreground flex gap-2">
                        <span className="text-blue-500 mt-0.5">•</span>
                        <span>{suggestion}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

          {/* Charts */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Tokens by Provider */}
            {byProviderData.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Tokens by Provider</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={byProviderData}>
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={formatTokens} />
                      <Tooltip
                        formatter={(value) => formatTokens(Number(value))}
                        contentStyle={{
                          backgroundColor: "var(--color-card)",
                          border: "1px solid var(--color-border)",
                          borderRadius: "0.375rem",
                          fontSize: 12,
                        }}
                      />
                      <Bar dataKey="input" name="Input" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="output" name="Output" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Cost Distribution */}
            {costPieData.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Cost Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie
                        data={costPieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        label={({ name, value }) => `${name}: $${value.toFixed(4)}`}
                        labelLine={false}
                      >
                        {costPieData.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value) => `$${Number(value).toFixed(4)}`}
                        contentStyle={{
                          backgroundColor: "var(--color-card)",
                          border: "1px solid var(--color-border)",
                          borderRadius: "0.375rem",
                          fontSize: 12,
                        }}
                      />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Tokens by Model */}
            {byModelData.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Tokens by Model</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={byModelData} layout="vertical">
                      <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={formatTokens} />
                      <YAxis
                        type="category"
                        dataKey="name"
                        tick={{ fontSize: 10 }}
                        width={120}
                      />
                      <Tooltip
                        formatter={(value) => formatTokens(Number(value))}
                        contentStyle={{
                          backgroundColor: "var(--color-card)",
                          border: "1px solid var(--color-border)",
                          borderRadius: "0.375rem",
                          fontSize: 12,
                        }}
                      />
                      <Bar dataKey="input" name="Input" fill="#06b6d4" radius={[0, 2, 2, 0]} />
                      <Bar dataKey="output" name="Output" fill="#f59e0b" radius={[0, 2, 2, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Cost by Agent */}
            {byAgentData.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Cost by Agent</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={byAgentData}>
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v.toFixed(3)}`} />
                      <Tooltip
                        formatter={(value) => `$${Number(value).toFixed(4)}`}
                        contentStyle={{
                          backgroundColor: "var(--color-card)",
                          border: "1px solid var(--color-border)",
                          borderRadius: "0.375rem",
                          fontSize: 12,
                        }}
                      />
                      <Bar dataKey="cost" name="Cost" fill="#10b981" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Top Expensive Goals */}
          {topGoals && topGoals.length > 0 && (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <Target className="h-3.5 w-3.5" />
                  Top Expensive Goals
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="pb-2 font-medium">Goal</th>
                        <th className="pb-2 font-medium text-right">Cost</th>
                        <th className="pb-2 font-medium text-right">Input Tokens</th>
                        <th className="pb-2 font-medium text-right">Output Tokens</th>
                        <th className="pb-2 font-medium text-right">Requests</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {topGoals.map((g) => (
                        <tr key={g.goalId}>
                          <td className="py-2 font-medium max-w-[300px] truncate" title={g.goalTitle}>
                            {g.goalTitle}
                          </td>
                          <td className="py-2 text-right tabular-nums">${g.totalCostUsd.toFixed(4)}</td>
                          <td className="py-2 text-right tabular-nums">{formatTokens(g.totalInputTokens)}</td>
                          <td className="py-2 text-right tabular-nums">{formatTokens(g.totalOutputTokens)}</td>
                          <td className="py-2 text-right tabular-nums">{g.requestCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Provider health table */}
          {providerHealthData && providerHealthData.providers.length > 0 && (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle className="text-sm">Provider Health</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="pb-2 font-medium">Provider</th>
                        <th className="pb-2 font-medium">Status</th>
                        <th className="pb-2 font-medium text-right">Requests</th>
                        <th className="pb-2 font-medium text-right">Success</th>
                        <th className="pb-2 font-medium text-right">Errors</th>
                        <th className="pb-2 font-medium text-right">Avg Latency</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {providerHealthData.providers.map((p) => (
                        <tr key={p.provider}>
                          <td className="py-2 font-medium">{p.provider}</td>
                          <td className="py-2">
                            <span
                              className={`inline-flex items-center gap-1 ${p.available ? "text-emerald-500" : "text-destructive"}`}
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${p.available ? "bg-emerald-500" : "bg-destructive"}`}
                              />
                              {p.available ? "Online" : "Offline"}
                            </span>
                          </td>
                          <td className="py-2 text-right tabular-nums">{p.totalRequests}</td>
                          <td className="py-2 text-right tabular-nums">{p.successCount}</td>
                          <td className="py-2 text-right tabular-nums">{p.errorCount}</td>
                          <td className="py-2 text-right tabular-nums">
                            {p.avgLatencyMs.toFixed(0)}ms
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}
