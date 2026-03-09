import { Check, X, SkipForward, Loader2, Clock } from "lucide-react";
import type {
  PipelineRunState,
  PipelineStageDefinition,
  PipelineStageResult,
} from "@ai-cofounder/api-client";

/* ── StageIcon ── */

export function StageIcon({
  status,
}: {
  status: "completed" | "failed" | "skipped" | "active" | "pending";
}) {
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

/* ── StageProgress ── */

export function StageProgress({
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
          <div key={i} className="flex items-center gap-1" title={`${stage.agent}: ${status}`}>
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
