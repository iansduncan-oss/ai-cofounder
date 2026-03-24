import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router";
import { usePipeline, useGoal } from "@/api/queries";
import { useCancelPipeline, useRetryPipeline } from "@/api/mutations";
import { PageHeader } from "@/components/layout/page-header";
import { usePageTitle } from "@/hooks/use-page-title";
import { ListSkeleton } from "@/components/common/loading-skeleton";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { PipelineStateBadge } from "@/routes/pipelines";
import { AlertTriangle, ArrowLeft, ChevronDown, ChevronRight, XCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StageIcon } from "@/components/pipelines/stage-progress";
import { formatDate } from "@/lib/utils";
import type { PipelineDetail, PipelineStageResult } from "@ai-cofounder/api-client";

function formatDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000)
    return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
  return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
}

function getStageStatus(
  data: PipelineDetail,
  resultMap: Map<number, PipelineStageResult>,
  i: number,
): "completed" | "failed" | "skipped" | "active" | "pending" {
  const result = resultMap.get(i);
  if (result) return result.status;
  if (data.state === "active" && i === data.currentStage) return "active";
  return "pending";
}

export function PipelineDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  usePageTitle("Pipeline Detail");

  const navigate = useNavigate();
  const { data, isLoading, error } = usePipeline(jobId ?? null);
  const { data: goal } = useGoal(data?.goalId ?? "");
  const cancelMutation = useCancelPipeline();
  const retryMutation = useRetryPipeline();

  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

  function toggleStage(i: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) {
        next.delete(i);
      } else {
        next.add(i);
      }
      return next;
    });
  }

  const shortId = jobId?.slice(0, 8) ?? "...";

  const resultMap = new Map<number, PipelineStageResult>(
    (data?.result?.stageResults ?? []).map((r) => [r.stageIndex, r]),
  );

  return (
    <div>
      <PageHeader
        title={`Pipeline ${shortId}`}
        description="Pipeline run detail"
        actions={
          <div className="flex items-center gap-2">
            {data && (data.state === "active" || data.state === "waiting" || data.state === "delayed") && (
              <Button
                variant="destructive"
                size="sm"
                disabled={cancelMutation.isPending}
                onClick={() => setCancelDialogOpen(true)}
              >
                <XCircle className="mr-1.5 h-3.5 w-3.5" />
                {cancelMutation.isPending ? "Cancelling…" : "Cancel"}
              </Button>
            )}
            {data?.state === "failed" && (
              <Button
                size="sm"
                disabled={retryMutation.isPending}
                onClick={() => {
                  retryMutation.mutate(jobId!, {
                    onSuccess: (result) => {
                      navigate(`/dashboard/pipelines/${result.jobId}`);
                    },
                  });
                }}
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                {retryMutation.isPending ? "Retrying…" : "Retry"}
              </Button>
            )}
            <Link to="/dashboard/pipelines">
              <Button variant="outline" size="sm">
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                Back to Pipelines
              </Button>
            </Link>
          </div>
        }
      />

      {isLoading ? (
        <ListSkeleton rows={3} />
      ) : error ? (
        <Card>
          <CardContent className="py-6">
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" />
              <span>Failed to load pipeline: {error.message}</span>
            </div>
          </CardContent>
        </Card>
      ) : data ? (
        <div className="space-y-4">
          <Card>
            <CardContent className="py-4 space-y-3">
              <div className="flex items-center gap-3">
                <PipelineStateBadge state={data.state} />
                <span className="text-sm text-muted-foreground">
                  {data.stages.length} stage{data.stages.length !== 1 ? "s" : ""}
                </span>
              </div>
              {data.goalId && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Goal:</span>
                  <Link
                    to={`/dashboard/goals/${data.goalId}`}
                    className="text-primary hover:underline truncate"
                  >
                    {goal?.title ?? data.goalId.slice(0, 8)}
                  </Link>
                </div>
              )}
              {data.createdAt && (
                <p className="text-xs text-muted-foreground">
                  Created: {formatDate(data.createdAt)}
                </p>
              )}
              {data.finishedAt && (
                <p className="text-xs text-muted-foreground">
                  Finished: {formatDate(data.finishedAt)}
                </p>
              )}
              {data.createdAt && data.finishedAt && (
                <p className="text-xs text-muted-foreground">
                  Duration: {formatDuration(data.createdAt, data.finishedAt)}
                </p>
              )}
              {data.failedReason && (
                <p className="text-xs text-destructive">
                  Failed: {data.failedReason}
                </p>
              )}
            </CardContent>
          </Card>

          {(data.state === "active" || data.state === "waiting") && (
            <p className="text-xs text-muted-foreground">Auto-refreshing every 5s</p>
          )}

          <div className="space-y-2">
            {data.stages.map((stage, i) => {
              const status = getStageStatus(data, resultMap, i);
              const isExpanded = expanded.has(i);
              const result = resultMap.get(i);
              const hasExpandableContent = result && (result.output || result.error);

              return (
                <div key={i}>
                  <div
                    role="button"
                    aria-expanded={isExpanded}
                    onClick={() => toggleStage(i)}
                    className="cursor-pointer rounded-lg border bg-card p-3 hover:bg-accent transition-colors flex items-center gap-3"
                  >
                    <StageIcon status={status} />
                    <span className="text-sm font-medium capitalize flex-1">
                      {stage.agent}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Stage {i + 1}
                    </span>
                    <span className="text-xs text-muted-foreground capitalize">
                      {status}
                    </span>
                    {isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </div>
                  {isExpanded && hasExpandableContent && (
                    <div className="rounded-b-lg border-x border-b bg-muted/50 px-3 pb-3 pt-2">
                      {result.output && (
                        <p className="whitespace-pre-wrap text-xs font-mono">
                          {result.output}
                        </p>
                      )}
                      {result.error && (
                        <p className="whitespace-pre-wrap text-xs text-destructive">
                          {result.error}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <Dialog open={cancelDialogOpen} onClose={() => setCancelDialogOpen(false)}>
        <DialogHeader>
          <DialogTitle>Cancel this pipeline run?</DialogTitle>
          <DialogDescription>
            This will cancel the pipeline and any in-progress stages. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setCancelDialogOpen(false)}>
            Keep Running
          </Button>
          <Button
            variant="destructive"
            disabled={cancelMutation.isPending}
            onClick={() => {
              cancelMutation.mutate(jobId!, {
                onSuccess: () => setCancelDialogOpen(false),
              });
            }}
          >
            {cancelMutation.isPending ? "Cancelling..." : "Yes, Cancel"}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
