import { useState } from "react";
import { useWorkSessions } from "@/api/queries";
import { useCancelWorkSession } from "@/api/mutations";
import { PageHeader } from "@/components/layout/page-header";
import { ListSkeleton } from "@/components/common/loading-skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { RelativeTime } from "@/components/common/relative-time";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { usePageTitle } from "@/hooks/use-page-title";
import {
  PlayCircle,
  Timer,
  Zap,
  ChevronDown,
  ChevronRight,
  StopCircle,
} from "lucide-react";
import { Link } from "react-router";
import type { WorkSession } from "@ai-cofounder/api-client";

type StatusKey = WorkSession["status"];

const statusConfig: Record<StatusKey, { label: string; color: string; dotColor: string }> = {
  running: { label: "Running", color: "text-blue-600", dotColor: "bg-blue-500" },
  completed: { label: "Completed", color: "text-green-600", dotColor: "bg-green-500" },
  failed: { label: "Failed", color: "text-red-600", dotColor: "bg-red-500" },
  timeout: { label: "Timeout", color: "text-amber-600", dotColor: "bg-amber-500" },
  skipped: { label: "Skipped", color: "text-gray-500", dotColor: "bg-gray-400" },
  aborted: { label: "Aborted", color: "text-orange-600", dotColor: "bg-orange-500" },
};

function formatDuration(ms: number | null): string {
  if (ms === null || ms <= 0) return "\u2014";
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function SessionCard({ session, onCancel }: { session: WorkSession; onCancel: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = statusConfig[session.status] ?? statusConfig.failed;
  const actions = Array.isArray(session.actionsTaken) ? session.actionsTaken : [];

  return (
    <div className="bg-card rounded-lg border border-border p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-left"
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
          <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${cfg.color}`}>
            <span className={`h-2 w-2 rounded-full ${cfg.dotColor}`} />
            {cfg.label}
          </span>
          <span className="text-xs text-muted-foreground capitalize">via {session.trigger}</span>
        </button>
        <div className="flex items-center gap-2">
          {session.status === "running" && (
            <Button variant="ghost" size="sm" className="h-7 text-destructive hover:text-destructive" onClick={() => onCancel(session.id)}>
              <StopCircle className="mr-1 h-3 w-3" />
              Cancel
            </Button>
          )}
          <span className="text-xs text-muted-foreground shrink-0">
            <RelativeTime date={session.createdAt} />
          </span>
        </div>
      </div>

      {session.summary && (
        <p className="text-sm text-muted-foreground">{session.summary}</p>
      )}

      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1">
          <Timer className="h-3.5 w-3.5" />
          {formatDuration(session.durationMs)}
        </span>
        <span className="flex items-center gap-1">
          <Zap className="h-3.5 w-3.5" />
          {session.tokensUsed?.toLocaleString() ?? "\u2014"} tokens
        </span>
        {session.goalId && (
          <Link to={`/dashboard/goals/${session.goalId}`} className="flex items-center gap-1 text-primary hover:underline">
            View goal
          </Link>
        )}
      </div>

      {expanded && actions.length > 0 && (
        <div className="border-t pt-3 mt-1">
          <p className="text-xs font-medium mb-2">Actions ({actions.length})</p>
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {actions.map((action: Record<string, unknown>, i: number) => (
              <div key={i} className="text-xs bg-muted rounded px-2 py-1.5 font-mono">
                <span className="font-semibold">{String(action.action ?? action.type ?? "action")}</span>
                {action.result ? <span className="text-muted-foreground ml-2">{String(action.result)}</span> : null}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function WorkSessionsPage() {
  usePageTitle("Work Sessions");
  const { data, isLoading } = useWorkSessions({ limit: 50 });
  const cancelSession = useCancelWorkSession();
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);

  const sessions = data?.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Work Sessions"
        description="History of autonomous work sessions with cancel controls"
      />

      {isLoading ? (
        <ListSkeleton rows={5} />
      ) : sessions.length === 0 ? (
        <EmptyState
          icon={<PlayCircle className="h-10 w-10" />}
          title="No sessions yet"
          description="Work sessions will appear here after the scheduler or manual triggers run."
        />
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              onCancel={(id) => setCancelTarget(id)}
            />
          ))}
        </div>
      )}

      <Dialog open={cancelTarget !== null} onClose={() => setCancelTarget(null)}>
        <DialogHeader>
          <DialogTitle>Cancel this work session?</DialogTitle>
          <DialogDescription>
            This will stop the running session and mark it as failed. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setCancelTarget(null)}>Keep Running</Button>
          <Button
            variant="destructive"
            disabled={cancelSession.isPending}
            onClick={() => {
              if (!cancelTarget) return;
              cancelSession.mutate(cancelTarget, {
                onSuccess: () => setCancelTarget(null),
              });
            }}
          >
            {cancelSession.isPending ? "Cancelling..." : "Yes, Cancel Session"}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
