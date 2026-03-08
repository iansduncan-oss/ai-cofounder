import { useState } from "react";
import { useListPipelines, usePipeline } from "@/api/queries";
import { useSubmitGoalPipeline } from "@/api/mutations";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ListSkeleton } from "@/components/common/loading-skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { usePageTitle } from "@/hooks/use-page-title";
import {
  AlertTriangle,
  Plus,
  Check,
  X,
  SkipForward,
  Loader2,
  Clock,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type {
  PipelineRun,
  PipelineRunState,
  PipelineStageDefinition,
  PipelineStageResult,
} from "@ai-cofounder/api-client";

/* ── PipelineStateBadge ── */

const stateConfig: Record<PipelineRunState, { label: string; variant: BadgeProps["variant"] }> = {
  waiting: { label: "Waiting", variant: "secondary" },
  active: { label: "Running", variant: "warning" },
  completed: { label: "Completed", variant: "success" },
  failed: { label: "Failed", variant: "destructive" },
  delayed: { label: "Delayed", variant: "outline" },
};

function PipelineStateBadge({ state }: { state: PipelineRunState }) {
  const config = stateConfig[state] ?? { label: state, variant: "outline" as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

/* ── StageProgress ── */

function StageIcon({ status }: { status: "completed" | "failed" | "skipped" | "active" | "pending" }) {
  switch (status) {
    case "completed":
      return <Check className="h-3.5 w-3.5 text-emerald-500" />;
    case "failed":
      return <X className="h-3.5 w-3.5 text-destructive" />;
    case "skipped":
      return <SkipForward className="h-3.5 w-3.5 text-muted-foreground" />;
    case "active":
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />;
    case "pending":
      return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function StageProgress({
  stages,
  stageResults,
  currentStage,
  pipelineState,
}: {
  stages: PipelineStageDefinition[];
  stageResults?: PipelineStageResult[];
  currentStage: number;
  pipelineState: PipelineRunState;
}) {
  const resultMap = new Map(stageResults?.map((r) => [r.stageIndex, r]));

  return (
    <div className="flex items-center gap-1">
      {stages.map((stage, i) => {
        const result = resultMap.get(i);
        let status: "completed" | "failed" | "skipped" | "active" | "pending";
        if (result) {
          status = result.status;
        } else if (pipelineState === "active" && i === currentStage) {
          status = "active";
        } else {
          status = "pending";
        }

        return (
          <div
            key={i}
            className="flex items-center gap-1"
            title={`${stage.agent}: ${status}`}
          >
            {i > 0 && <div className="h-px w-3 bg-border" />}
            <div className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs">
              <StageIcon status={status} />
              <span className="capitalize">{stage.agent}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── PipelineRow ── */

function PipelineRow({ run }: { run: PipelineRun }) {
  const [expanded, setExpanded] = useState(false);
  const { data: detail } = usePipeline(expanded ? (run.jobId ?? null) : null);

  return (
    <Card>
      <CardHeader
        className="cursor-pointer flex flex-row items-center justify-between space-y-0 pb-2"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <div>
            <CardTitle className="text-sm font-medium">
              Pipeline {run.pipelineId.slice(0, 8)}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Goal: {run.goalId.slice(0, 8)} &middot; {run.stageCount} stages
              {run.createdAt && (
                <> &middot; {new Date(run.createdAt).toLocaleString()}</>
              )}
            </p>
          </div>
        </div>
        <PipelineStateBadge state={run.state} />
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-3">
          {detail ? (
            <>
              <StageProgress
                stages={detail.stages}
                stageResults={detail.result?.stageResults}
                currentStage={detail.currentStage}
                pipelineState={detail.state}
              />

              {detail.failedReason && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                  {detail.failedReason}
                </div>
              )}

              {detail.result?.stageResults && detail.result.stageResults.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Stage Results</p>
                  {detail.result.stageResults.map((sr) => (
                    <div
                      key={sr.stageIndex}
                      className="rounded-md border p-2 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium capitalize">{sr.agent}</span>
                        <Badge
                          variant={
                            sr.status === "completed"
                              ? "success"
                              : sr.status === "failed"
                                ? "destructive"
                                : "secondary"
                          }
                        >
                          {sr.status}
                        </Badge>
                      </div>
                      {sr.output && (
                        <pre className="whitespace-pre-wrap text-muted-foreground max-h-40 overflow-auto">
                          {sr.output.slice(0, 500)}
                          {sr.output.length > 500 && "..."}
                        </pre>
                      )}
                      {sr.error && (
                        <p className="text-destructive">{sr.error}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading details...
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

/* ── SubmitPipelineDialog ── */

function SubmitPipelineDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [goalId, setGoalId] = useState("");
  const mutation = useSubmitGoalPipeline();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!goalId.trim()) return;
    mutation.mutate(
      { goalId: goalId.trim() },
      {
        onSuccess: () => {
          setGoalId("");
          onClose();
        },
      },
    );
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Run Pipeline</DialogTitle>
        <DialogDescription>
          Submit a standard plan-code-review pipeline for a goal.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-sm font-medium" htmlFor="pipeline-goal-id">
            Goal ID
          </label>
          <Input
            id="pipeline-goal-id"
            value={goalId}
            onChange={(e) => setGoalId(e.target.value)}
            placeholder="Enter goal UUID"
            required
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Submitting..." : "Submit"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/* ── PipelinesPage ── */

export function PipelinesPage() {
  usePageTitle("Pipelines");
  const { data, isLoading, error } = useListPipelines();
  const [dialogOpen, setDialogOpen] = useState(false);

  const runs = data?.runs ?? [];

  return (
    <div>
      <PageHeader
        title="Pipelines"
        description="Multi-stage agent pipeline runs"
        actions={
          <Button onClick={() => setDialogOpen(true)} size="sm">
            <Plus className="mr-1 h-4 w-4" />
            Run Pipeline
          </Button>
        }
      />

      <div className="space-y-3">
        {isLoading ? (
          <ListSkeleton rows={3} />
        ) : error ? (
          <Card>
            <CardContent className="py-6">
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4" />
                <span>Failed to load pipelines: {error.message}</span>
              </div>
            </CardContent>
          </Card>
        ) : runs.length === 0 ? (
          <EmptyState
            title="No pipeline runs"
            description="Submit a pipeline to run multi-stage agent workflows."
            action={
              <Button onClick={() => setDialogOpen(true)} size="sm">
                <Plus className="mr-1 h-4 w-4" />
                Run Pipeline
              </Button>
            }
          />
        ) : (
          runs.map((run) => <PipelineRow key={run.jobId} run={run} />)
        )}
      </div>

      <SubmitPipelineDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}
