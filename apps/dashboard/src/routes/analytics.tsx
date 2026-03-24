import { useState } from "react";
import { useNavigate } from "react-router";
import {
  useUsage,
  useProviderHealth,
  useDailyCost,
  useBudgetStatus,
  useTopExpensiveGoals,
  useToolStats,
} from "@/api/queries";
import { PageHeader } from "@/components/layout/page-header";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CardSkeleton } from "@/components/common/loading-skeleton";
import { usePageTitle } from "@/hooks/use-page-title";
import {
  AlertTriangle,
  Activity,
  DollarSign,
  Cpu,
  Zap,
  TrendingDown,
  Target,
  Wrench,
  CheckCircle,
  Timer,
} from "lucide-react";
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
type Tab = "overview" | "costs" | "tools";

const TABS: { label: string; value: Tab }[] = [
  { label: "Overview", value: "overview" },
  { label: "Costs", value: "costs" },
  { label: "Tools", value: "tools" },
];

const formatTokens = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
      ? `${(n / 1_000).toFixed(1)}K`
      : String(n);

const tooltipStyle = {
  backgroundColor: "var(--color-card)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.375rem",
  fontSize: 12,
};

export function AnalyticsPage() {
  usePageTitle("Analytics");
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [period, setPeriod] = useState<Period>("today");
  const navigate = useNavigate();

  const { data: usage, isLoading, error } = useUsage(activeTab === "costs" ? period : "today");
  const { data: providerHealthData } = useProviderHealth();
  const { data: dailyData } = useDailyCost(30);
  const { data: budgetData } = useBudgetStatus();
  const { data: topGoals } = useTopExpensiveGoals(10);
  const { data: toolStatsData } = useToolStats();

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

  const toolStats = toolStatsData?.tools ?? [];
  const totalExecutions = toolStats.reduce((s, t) => s + t.totalExecutions, 0);
  const avgSuccessRate =
    totalExecutions > 0
      ? (toolStats.reduce((s, t) => s + t.successCount, 0) / totalExecutions) * 100
      : 0;
  const avgLatency =
    toolStats.length > 0
      ? toolStats.reduce((s, t) => s + t.avgDurationMs, 0) / toolStats.length
      : 0;

  return (
    <div>
      <PageHeader
        title="Analytics"
        description="Cost, usage, and tool performance insights"
        actions={
          activeTab === "costs" ? (
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
          ) : undefined
        }
      />

      {/* Tab bar */}
      <div className="flex gap-1 rounded-lg bg-muted p-1 mb-6">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === tab.value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === "overview" && (
        <>
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
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
                <StatCard icon={DollarSign} label="Today's Cost" value={`$${usage.totalCostUsd.toFixed(4)}`} />
                <StatCard
                  icon={Zap}
                  label="Today's Tokens"
                  value={formatTokens(usage.totalInputTokens + usage.totalOutputTokens)}
                  sub={`${formatTokens(usage.totalInputTokens)} in / ${formatTokens(usage.totalOutputTokens)} out`}
                />
                <StatCard icon={Activity} label="Requests" value={String(usage.requestCount)} />
                <StatCard
                  icon={Cpu}
                  label="Active Providers"
                  value={String(providerHealthData?.providers.filter((p) => p.available).length ?? 0)}
                  sub={`${providerHealthData?.providers.length ?? 0} configured`}
                />
              </div>

              <Card className="mb-6">
                <CardHeader>
                  <CardTitle className="text-sm">Daily Cost Trend</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={180}>
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
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => "$" + Number(v).toFixed(3)} />
                      <Tooltip
                        formatter={(value) => ["$" + Number(value).toFixed(4), "Cost"]}
                        contentStyle={tooltipStyle}
                      />
                      <Line type="monotone" dataKey="costUsd" stroke="#3b82f6" dot={false} strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <div className="grid gap-4 sm:grid-cols-2 mb-6">
                <BudgetGauge label="Daily Budget" data={budgetData?.daily} />
                <BudgetGauge label="Weekly Budget" data={budgetData?.weekly} />
              </div>

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

              <ProviderHealthTable providers={providerHealthData?.providers} />
            </>
          ) : null}
        </>
      )}

      {/* Costs Tab */}
      {activeTab === "costs" && (
        <>
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
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
                <StatCard
                  icon={Zap}
                  label="Total Tokens"
                  value={formatTokens(usage.totalInputTokens + usage.totalOutputTokens)}
                  sub={`${formatTokens(usage.totalInputTokens)} in / ${formatTokens(usage.totalOutputTokens)} out`}
                />
                <StatCard icon={DollarSign} label="Total Cost" value={`$${usage.totalCostUsd.toFixed(4)}`} />
                <StatCard icon={Activity} label="Requests" value={String(usage.requestCount)} />
                <StatCard
                  icon={Cpu}
                  label="Providers"
                  value={String(providerHealthData?.providers.filter((p) => p.available).length ?? 0)}
                  sub={`${providerHealthData?.providers.length ?? 0} configured`}
                />
              </div>

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
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => "$" + Number(v).toFixed(3)} />
                      <Tooltip
                        formatter={(value) => ["$" + Number(value).toFixed(4), "Cost"]}
                        contentStyle={tooltipStyle}
                      />
                      <Line type="monotone" dataKey="costUsd" stroke="#3b82f6" dot={false} strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <div className="grid gap-6 lg:grid-cols-2 mb-6">
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
                          <Tooltip formatter={(value) => formatTokens(Number(value))} contentStyle={tooltipStyle} />
                          <Bar dataKey="input" name="Input" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                          <Bar dataKey="output" name="Output" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                )}

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
                          <Tooltip formatter={(value) => `$${Number(value).toFixed(4)}`} contentStyle={tooltipStyle} />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                )}

                {byModelData.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Tokens by Model</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={byModelData} layout="vertical">
                          <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={formatTokens} />
                          <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={120} />
                          <Tooltip formatter={(value) => formatTokens(Number(value))} contentStyle={tooltipStyle} />
                          <Bar dataKey="input" name="Input" fill="#06b6d4" radius={[0, 2, 2, 0]} />
                          <Bar dataKey="output" name="Output" fill="#f59e0b" radius={[0, 2, 2, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                )}

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
                          <Tooltip formatter={(value) => `$${Number(value).toFixed(4)}`} contentStyle={tooltipStyle} />
                          <Bar dataKey="cost" name="Cost" fill="#10b981" radius={[2, 2, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                )}
              </div>

              {topGoals && topGoals.length > 0 && (
                <Card>
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
                            <tr
                              key={g.goalId}
                              className="cursor-pointer hover:bg-accent/50"
                              onClick={() => navigate(`/dashboard/goals/${g.goalId}`)}
                            >
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
            </>
          ) : null}
        </>
      )}

      {/* Tools Tab */}
      {activeTab === "tools" && (
        <>
          <div className="grid gap-4 sm:grid-cols-3 mb-6">
            <StatCard icon={Wrench} label="Total Executions" value={totalExecutions.toLocaleString()} />
            <StatCard icon={CheckCircle} label="Avg Success Rate" value={`${avgSuccessRate.toFixed(1)}%`} />
            <StatCard icon={Timer} label="Avg Latency" value={`${avgLatency.toFixed(0)}ms`} />
          </div>

          {toolStats.length > 0 && (
            <div className="grid gap-6 lg:grid-cols-2 mb-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Avg Duration by Tool</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart
                      data={toolStats.slice(0, 10).map((t) => ({
                        name: t.toolName.length > 15 ? t.toolName.slice(0, 13) + "..." : t.toolName,
                        avgMs: t.avgDurationMs,
                      }))}
                      layout="vertical"
                    >
                      <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}ms`} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={110} />
                      <Tooltip
                        formatter={(value) => [`${Number(value).toFixed(0)}ms`, "Avg Duration"]}
                        contentStyle={tooltipStyle}
                      />
                      <Bar dataKey="avgMs" fill="#8b5cf6" radius={[0, 2, 2, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Success vs Errors</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart
                      data={toolStats.slice(0, 10).map((t) => ({
                        name: t.toolName.length > 15 ? t.toolName.slice(0, 13) + "..." : t.toolName,
                        success: t.successCount,
                        errors: t.errorCount,
                      }))}
                    >
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={50} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="success" name="Success" fill="#10b981" stackId="a" />
                      <Bar dataKey="errors" name="Errors" fill="#ef4444" stackId="a" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          )}

          {toolStats.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Tool Execution Stats</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="pb-2 font-medium">Tool</th>
                        <th className="pb-2 font-medium text-right">Executions</th>
                        <th className="pb-2 font-medium text-right">Success</th>
                        <th className="pb-2 font-medium text-right">Errors</th>
                        <th className="pb-2 font-medium text-right">Avg Latency</th>
                        <th className="pb-2 font-medium text-right">P95 Latency</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {toolStats.map((t) => (
                        <tr key={t.toolName}>
                          <td className="py-2 font-medium">{t.toolName}</td>
                          <td className="py-2 text-right tabular-nums">{t.totalExecutions}</td>
                          <td className="py-2 text-right tabular-nums text-emerald-500">{t.successCount}</td>
                          <td className="py-2 text-right tabular-nums text-destructive">{t.errorCount}</td>
                          <td className="py-2 text-right tabular-nums">{t.avgDurationMs.toFixed(0)}ms</td>
                          <td className="py-2 text-right tabular-nums">{t.p95DurationMs.toFixed(0)}ms</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Wrench className="mb-3 h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No tool execution data yet</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Sub-components ── */

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function BudgetGauge({
  label,
  data,
}: {
  label: string;
  data?: { limitUsd: number; spentUsd: number; percentUsed: number | null };
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        {!data || data.limitUsd === 0 ? (
          <p className="text-sm text-muted-foreground">No limit configured</p>
        ) : (
          <>
            <p className="text-sm mb-2">
              ${data.spentUsd.toFixed(4)} / ${data.limitUsd.toFixed(2)}
            </p>
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  (data.percentUsed ?? 0) > 100
                    ? "bg-red-500"
                    : (data.percentUsed ?? 0) > 90
                      ? "bg-yellow-500"
                      : "bg-blue-500"
                }`}
                style={{ width: `${Math.min(data.percentUsed ?? 0, 100)}%` }}
              />
            </div>
            {data.percentUsed != null && (
              <p className="text-xs text-muted-foreground mt-1">{data.percentUsed.toFixed(1)}% used</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ProviderHealthTable({
  providers,
}: {
  providers?: Array<{
    provider: string;
    available: boolean;
    totalRequests: number;
    successCount: number;
    errorCount: number;
    avgLatencyMs: number;
  }>;
}) {
  if (!providers || providers.length === 0) return null;
  return (
    <Card>
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
              {providers.map((p) => (
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
                  <td className="py-2 text-right tabular-nums">{p.avgLatencyMs.toFixed(0)}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
