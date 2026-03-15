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

export function AutonomousSessionsPage() {
  usePageTitle("Autonomous Sessions");
  const { data, isLoading } = useAutonomousSessions(50);

  const sessions = data?.data ?? [];

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
        <div className="space-y-3">
          {sessions.map((session) => (
            <SessionCard key={session.id} session={session} />
          ))}
        </div>
      )}
    </div>
  );
}
