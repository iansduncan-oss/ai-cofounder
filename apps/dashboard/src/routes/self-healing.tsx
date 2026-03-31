import { useSelfHealingStatus, useSelfHealingReport } from "@/api/queries";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CardSkeleton } from "@/components/common/loading-skeleton";
import { RelativeTime } from "@/components/common/relative-time";
import { usePageTitle } from "@/hooks/use-page-title";
import type { AgentHealthScore, CircuitBreakerState, FailurePattern } from "@ai-cofounder/api-client";
import {
  HeartPulse,
  ShieldAlert,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Activity,
  Lightbulb,
  Zap,
  TrendingDown,
} from "lucide-react";

function circuitBadge(status: CircuitBreakerState["status"]) {
  switch (status) {
    case "closed":
      return <Badge variant="default" className="bg-emerald-500/15 text-emerald-600 border-emerald-500/20">Closed</Badge>;
    case "open":
      return <Badge variant="destructive">Open</Badge>;
    case "half-open":
      return <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/20">Half-Open</Badge>;
  }
}

function healthColor(score: number) {
  if (score >= 80) return "text-emerald-500";
  if (score >= 50) return "text-amber-500";
  return "text-destructive";
}

function healthBg(score: number) {
  if (score >= 80) return "bg-emerald-500";
  if (score >= 50) return "bg-amber-500";
  return "bg-destructive";
}

function HealthBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${healthBg(score)}`}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className={`text-sm font-bold tabular-nums ${healthColor(score)}`}>
        {score}
      </span>
    </div>
  );
}

function AgentHealthCard({ agent }: { agent: AgentHealthScore }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium capitalize">
          {agent.agentRole}
        </CardTitle>
        {circuitBadge(agent.circuitBreaker.status)}
      </CardHeader>
      <CardContent className="space-y-3">
        <HealthBar score={agent.score} />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <CheckCircle className="h-3 w-3 text-emerald-500" />
            {agent.recentSuccesses} successes
          </span>
          <span className="flex items-center gap-1">
            <XCircle className="h-3 w-3 text-destructive" />
            {agent.recentFailures} failures
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function FailurePatternRow({ pattern }: { pattern: FailurePattern }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border p-3">
      <TrendingDown className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <code className="text-sm font-medium truncate">{pattern.key}</code>
          <Badge variant="secondary" className="shrink-0">{pattern.count}x</Badge>
        </div>
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span>First: <RelativeTime date={pattern.firstSeen} /></span>
          <span>Last: <RelativeTime date={pattern.lastSeen} /></span>
        </div>
        {pattern.samples.length > 0 && (
          <p className="text-xs text-muted-foreground truncate">
            {pattern.samples[0]}
          </p>
        )}
      </div>
    </div>
  );
}

export function SelfHealingPage() {
  usePageTitle("Self-Healing");

  const { data: status, isLoading: statusLoading, error: statusError } = useSelfHealingStatus();
  const { data: report, isLoading: reportLoading } = useSelfHealingReport();

  if (statusError) {
    return (
      <div>
        <PageHeader title="Self-Healing" description="Agent health, circuit breakers, and failure patterns" />
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <AlertTriangle className="mb-3 h-8 w-8 text-destructive" />
          <p className="text-sm font-medium">Failed to load self-healing data</p>
          <p className="mt-1 text-xs text-muted-foreground">{statusError.message}</p>
        </div>
      </div>
    );
  }

  const isLoading = statusLoading || reportLoading;

  const openBreakers = status
    ? Object.entries(status.circuitBreakers).filter(([, cb]) => cb.status !== "closed")
    : [];

  const avgHealth = status?.healthScores.length
    ? Math.round(status.healthScores.reduce((sum, h) => sum + h.score, 0) / status.healthScores.length)
    : 0;

  return (
    <div>
      <PageHeader
        title="Self-Healing"
        description="Agent health, circuit breakers, and failure patterns"
      />

      {/* Summary cards */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">System Health</CardTitle>
                <HeartPulse className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${healthColor(avgHealth)}`}>
                  {avgHealth}%
                </div>
                <p className="text-xs text-muted-foreground">
                  Average across {status?.healthScores.length ?? 0} agents
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Circuit Breakers</CardTitle>
                <ShieldAlert className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${openBreakers.length > 0 ? "text-destructive" : "text-emerald-500"}`}>
                  {openBreakers.length} open
                </div>
                <p className="text-xs text-muted-foreground">
                  {Object.keys(status?.circuitBreakers ?? {}).length} total tracked
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Failure Patterns</CardTitle>
                <Zap className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${(status?.recentFailurePatterns.length ?? 0) > 0 ? "text-amber-500" : "text-emerald-500"}`}>
                  {status?.recentFailurePatterns.length ?? 0}
                </div>
                <p className="text-xs text-muted-foreground">
                  Systematic patterns detected
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Failures Tracked</CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {status?.totalFailuresTracked ?? 0}
                </div>
                <p className="text-xs text-muted-foreground">
                  {status?.oldestRecord ? (
                    <>Since <RelativeTime date={status.oldestRecord} /></>
                  ) : (
                    "No failures recorded"
                  )}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Agent Health Scores */}
          {status && status.healthScores.length > 0 && (
            <div className="mt-6">
              <h3 className="mb-3 text-sm font-semibold">Agent Health</h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {status.healthScores.map((agent) => (
                  <AgentHealthCard key={agent.agentRole} agent={agent} />
                ))}
              </div>
            </div>
          )}

          {/* Open Circuit Breakers */}
          {openBreakers.length > 0 && (
            <div className="mt-6">
              <h3 className="mb-3 text-sm font-semibold flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-destructive" />
                Open Circuit Breakers
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {openBreakers.map(([role, cb]) => (
                  <Card key={role} className="border-destructive/30">
                    <CardContent className="pt-4">
                      <div className="flex items-center justify-between">
                        <span className="font-medium capitalize">{role}</span>
                        {circuitBadge(cb.status)}
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <span>Failures: {cb.failureCount}</span>
                        <span>Successes: {cb.successCount}</span>
                        {cb.openedAt && (
                          <span className="col-span-2 flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Opened <RelativeTime date={cb.openedAt} />
                          </span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Failure Patterns */}
          {status && status.recentFailurePatterns.length > 0 && (
            <div className="mt-6">
              <h3 className="mb-3 text-sm font-semibold flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-amber-500" />
                Systematic Failure Patterns
              </h3>
              <div className="space-y-2">
                {status.recentFailurePatterns.map((pattern) => (
                  <FailurePatternRow key={pattern.key} pattern={pattern} />
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          {report && report.recommendations.length > 0 && (
            <div className="mt-6">
              <h3 className="mb-3 text-sm font-semibold flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-amber-500" />
                Recommendations
              </h3>
              <Card>
                <CardContent className="pt-4">
                  <ul className="space-y-2">
                    {report.recommendations.map((rec, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        {rec}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Empty state */}
          {status?.enabled && status.healthScores.length === 0 && status.totalFailuresTracked === 0 && (
            <div className="mt-6 flex flex-col items-center justify-center py-12 text-center">
              <HeartPulse className="mb-3 h-8 w-8 text-emerald-500" />
              <p className="text-sm font-medium">All systems healthy</p>
              <p className="mt-1 text-xs text-muted-foreground">
                No failures have been recorded. The self-healing service is monitoring.
              </p>
            </div>
          )}

          {status && !status.enabled && (
            <div className="mt-6 flex flex-col items-center justify-center py-12 text-center">
              <AlertTriangle className="mb-3 h-8 w-8 text-amber-500" />
              <p className="text-sm font-medium">Self-healing is disabled</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Set ENABLE_SELF_HEALING=true to activate.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
