import { useAutonomousSessions } from "@/api/queries";
import { PageHeader } from "@/components/layout/page-header";
import { ListSkeleton } from "@/components/common/loading-skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { RelativeTime } from "@/components/common/relative-time";
import { usePageTitle } from "@/hooks/use-page-title";
import {
  PlayCircle,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Timer,
  Zap,
} from "lucide-react";
import { Link } from "react-router";
import type { WorkSession } from "@ai-cofounder/api-client";

type StatusKey = WorkSession["status"];

interface StatusConfig {
  label: string;
  color: string;
  dotColor: string;
  Icon: typeof PlayCircle;
}

const statusConfig: Record<StatusKey, StatusConfig> = {
  running: {
    label: "Running",
    color: "text-blue-600",
    dotColor: "bg-blue-500",
    Icon: PlayCircle,
  },
  completed: {
    label: "Completed",
    color: "text-green-600",
    dotColor: "bg-green-500",
    Icon: CheckCircle2,
  },
  failed: {
    label: "Failed",
    color: "text-red-600",
    dotColor: "bg-red-500",
    Icon: XCircle,
  },
  timeout: {
    label: "Timeout",
    color: "text-amber-600",
    dotColor: "bg-amber-500",
    Icon: Clock,
  },
  skipped: {
    label: "Skipped",
    color: "text-gray-500",
    dotColor: "bg-gray-400",
    Icon: AlertTriangle,
  },
  aborted: {
    label: "Aborted",
    color: "text-orange-600",
    dotColor: "bg-orange-500",
    Icon: AlertTriangle,
  },
};

function formatDuration(ms: number | null): string {
  if (ms === null || ms <= 0) return "—";
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function formatTokens(tokens: number | null): string {
  if (tokens === null) return "—";
  return tokens.toLocaleString();
}

interface SessionCardProps {
  session: WorkSession;
}

function SessionCard({ session }: SessionCardProps) {
  const cfg = statusConfig[session.status] ?? statusConfig.failed;
  const { Icon } = cfg;
  const truncatedSummary =
    session.summary && session.summary.length > 100
      ? `${session.summary.slice(0, 100)}…`
      : session.summary;

  return (
    <div className="bg-card rounded-lg border border-border p-4 flex flex-col gap-3">
      {/* Header: status + trigger + time */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 text-sm font-medium ${cfg.color}`}
            data-testid="status-badge"
          >
            <span className={`h-2 w-2 rounded-full ${cfg.dotColor}`} />
            {cfg.label}
          </span>
          <span className="text-xs text-muted-foreground capitalize">
            via {session.trigger}
          </span>
        </div>
        <span className="text-xs text-muted-foreground shrink-0">
          <RelativeTime date={session.createdAt} />
        </span>
      </div>

      {/* Summary */}
      {truncatedSummary && (
        <p className="text-sm text-muted-foreground">{truncatedSummary}</p>
      )}

      {/* Stats row: duration + tokens + goal link */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1">
          <Timer className="h-3.5 w-3.5" />
          {formatDuration(session.durationMs)}
        </span>
        <span className="flex items-center gap-1">
          <Zap className="h-3.5 w-3.5" />
          {formatTokens(session.tokensUsed)} tokens
        </span>
        {session.goalId && (
          <Link
            to={`/dashboard/goals/${session.goalId}`}
            className="flex items-center gap-1 text-primary hover:underline"
          >
            <Icon className="h-3.5 w-3.5" />
            View goal
          </Link>
        )}
      </div>
    </div>
  );
}

function SessionActivityGrid({ sessions }: { sessions: WorkSession[] }) {
  // Build 7-day × 6 time-slots (4h each) grid
  const now = new Date();
  const grid: Array<{ day: string; slot: number; total: number; completed: number; failed: number }> = [];

  for (let d = 6; d >= 0; d--) {
    const date = new Date(now);
    date.setDate(date.getDate() - d);
    const dayStr = date.toLocaleDateString("en-US", { weekday: "short" });
    const dateStr = date.toISOString().split("T")[0];

    for (let slot = 0; slot < 6; slot++) {
      const slotStart = slot * 4;
      const slotEnd = slotStart + 4;
      const matching = sessions.filter((s) => {
        const sd = new Date(s.createdAt);
        return sd.toISOString().split("T")[0] === dateStr && sd.getHours() >= slotStart && sd.getHours() < slotEnd;
      });
      grid.push({
        day: dayStr,
        slot,
        total: matching.length,
        completed: matching.filter((s) => s.status === "completed").length,
        failed: matching.filter((s) => s.status === "failed" || s.status === "timeout").length,
      });
    }
  }

  const slotLabels = ["0-4", "4-8", "8-12", "12-16", "16-20", "20-24"];
  const days = [...new Set(grid.map((g) => g.day))];

  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="mb-3 text-sm font-medium">Session Activity (7 days)</p>
      <div className="flex gap-1">
        <div className="flex flex-col gap-1 pr-1 pt-5">
          {slotLabels.map((l) => (
            <div key={l} className="flex h-5 items-center text-[9px] text-muted-foreground">{l}</div>
          ))}
        </div>
        {days.map((day) => (
          <div key={day} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-[9px] text-muted-foreground">{day}</span>
            {grid.filter((g) => g.day === day).map((cell, i) => {
              const bg = cell.total === 0
                ? "bg-muted"
                : cell.failed > 0
                  ? "bg-red-400 dark:bg-red-600"
                  : cell.completed > 0
                    ? "bg-emerald-400 dark:bg-emerald-600"
                    : "bg-blue-400 dark:bg-blue-600";
              return (
                <div
                  key={i}
                  className={`h-5 w-full rounded-sm ${bg} transition-colors`}
                  title={`${cell.day} ${slotLabels[cell.slot]}h: ${cell.total} session${cell.total !== 1 ? "s" : ""} (${cell.completed} ok, ${cell.failed} fail)`}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-3 text-[9px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-muted" /> None</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-400" /> Completed</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-red-400" /> Failed</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-blue-400" /> Running</span>
      </div>
    </div>
  );
}

export function AutonomousSessionsPage() {
  usePageTitle("Autonomous Sessions");
  const { data, isLoading } = useAutonomousSessions(50);

  const sessions = data?.data ?? [];

  // Summary stats
  const completed = sessions.filter((s) => s.status === "completed").length;
  const failed = sessions.filter((s) => s.status === "failed" || s.status === "timeout").length;
  const totalTokens = sessions.reduce((s, sess) => s + (sess.tokensUsed ?? 0), 0);
  const avgDuration = sessions.length > 0
    ? sessions.reduce((s, sess) => s + (sess.durationMs ?? 0), 0) / sessions.length
    : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Autonomous Sessions"
        description="History of autonomous work sessions"
      />

      {isLoading ? (
        <ListSkeleton rows={5} />
      ) : sessions.length === 0 ? (
        <EmptyState
          icon={<PlayCircle className="h-10 w-10" />}
          title="No sessions yet"
          description="Autonomous work sessions will appear here after the scheduler or manual triggers run."
        />
      ) : (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-lg font-semibold">{sessions.length}</p>
            </div>
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">Success Rate</p>
              <p className="text-lg font-semibold">
                {sessions.length > 0 ? Math.round((completed / sessions.length) * 100) : 0}%
              </p>
            </div>
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">Total Tokens</p>
              <p className="text-lg font-semibold">{formatTokens(totalTokens)}</p>
            </div>
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">Avg Duration</p>
              <p className="text-lg font-semibold">{formatDuration(avgDuration)}</p>
            </div>
          </div>

          {/* Activity heatmap */}
          <SessionActivityGrid sessions={sessions} />

          {/* Session list */}
          <div className="space-y-3">
            {sessions.map((session) => (
              <SessionCard key={session.id} session={session} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
