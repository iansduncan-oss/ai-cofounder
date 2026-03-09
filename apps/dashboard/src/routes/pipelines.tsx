import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useListPipelines } from "@/api/queries";
import { useSubmitGoalPipeline } from "@/api/mutations";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ListSkeleton } from "@/components/common/loading-skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { RelativeTime } from "@/components/common/relative-time";
import { usePageTitle } from "@/hooks/use-page-title";
import { AlertTriangle, Plus } from "lucide-react";
import type { PipelineRun, PipelineRunState } from "@ai-cofounder/api-client";

/* ── PipelineStateBadge ── */

const stateConfig: Record<PipelineRunState, { label: string; variant: BadgeProps["variant"] }> = {
  waiting: { label: "Waiting", variant: "secondary" },
  active: { label: "Running", variant: "warning" },
  completed: { label: "Completed", variant: "success" },
  failed: { label: "Failed", variant: "destructive" },
  delayed: { label: "Delayed", variant: "outline" },
};

export function PipelineStateBadge({ state }: { state: PipelineRunState }) {
  const config = stateConfig[state] ?? { label: state, variant: "outline" as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

/* ── formatDuration ── */

function formatDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000)
    return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
  return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(false);

  const stateFilter = searchParams.get("state") ?? "all";

  const setFilter = (value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === "" || value === "all") {
        next.delete("state");
      } else {
        next.set("state", value);
      }
      return next;
    });
  };

  const { data, isLoading, error } = useListPipelines();
  const runs = data?.runs ?? [];

  const filtered =
    stateFilter === "all"
      ? runs
      : runs.filter((r: PipelineRun) => r.state === stateFilter);

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

      <div className="mb-4 flex items-center gap-3">
        <Select
          value={stateFilter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-40"
        >
          <option value="all">All states</option>
          <option value="waiting">Waiting</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </Select>
        {stateFilter !== "all" && (
          <span className="text-xs text-muted-foreground">
            {filtered.length} result{filtered.length !== 1 ? "s" : ""} filtered
          </span>
        )}
      </div>
      <p className="mb-4 text-xs text-muted-foreground">Auto-refreshing every 10s</p>

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
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No pipeline runs"
            description={
              stateFilter !== "all"
                ? "No runs match the selected filter."
                : "Submit a pipeline to run multi-stage agent workflows."
            }
            action={
              stateFilter === "all" ? (
                <Button onClick={() => setDialogOpen(true)} size="sm">
                  <Plus className="mr-1 h-4 w-4" />
                  Run Pipeline
                </Button>
              ) : undefined
            }
          />
        ) : (
          filtered.map((run: PipelineRun) => (
            <Link
              key={run.jobId}
              to={`/dashboard/pipelines/${run.jobId}`}
              className="block rounded-lg border bg-card p-4 transition-all hover:bg-accent hover:shadow-md hover:-translate-y-0.5"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">
                    Pipeline {run.pipelineId.slice(0, 8)}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Goal: {run.goalId.slice(0, 8)} &middot; {run.stageCount} stages
                    {run.createdAt && (
                      <>
                        {" "}
                        &middot; <RelativeTime date={run.createdAt} />
                      </>
                    )}
                    {run.finishedAt && run.createdAt && (
                      <> &middot; {formatDuration(run.createdAt, run.finishedAt)}</>
                    )}
                  </p>
                </div>
                <PipelineStateBadge state={run.state} />
              </div>
            </Link>
          ))
        )}
      </div>

      <SubmitPipelineDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}
