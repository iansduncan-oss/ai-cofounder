import { useState } from "react";
import { useNavigate } from "react-router";
import { useSubmitGoalPipeline, useSubmitPipeline } from "@/api/mutations";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import type { PipelineAgentRole } from "@ai-cofounder/api-client";

const AGENT_ROLES: PipelineAgentRole[] = ["planner", "coder", "reviewer", "debugger", "researcher"];

interface StageInput {
  agent: PipelineAgentRole;
  prompt: string;
  dependsOnPrevious: boolean;
}

const DEFAULT_STAGES: StageInput[] = [
  { agent: "planner", prompt: "", dependsOnPrevious: false },
];

interface SubmitPipelineDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SubmitPipelineDialog({ open, onClose }: SubmitPipelineDialogProps) {
  const navigate = useNavigate();
  const goalMutation = useSubmitGoalPipeline();
  const customMutation = useSubmitPipeline();

  const [mode, setMode] = useState<"goal" | "custom">("goal");
  const [goalId, setGoalId] = useState("");
  const [stages, setStages] = useState<StageInput[]>(DEFAULT_STAGES);

  function handleClose() {
    onClose();
    setGoalId("");
    setMode("goal");
    setStages([{ agent: "planner", prompt: "", dependsOnPrevious: false }]);
  }

  function handleGoalSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!goalId.trim()) return;
    goalMutation.mutate(
      { goalId: goalId.trim() },
      {
        onSuccess: (data) => {
          handleClose();
          navigate(`/dashboard/pipelines/${data.jobId}`);
        },
      },
    );
  }

  function handleCustomSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!goalId.trim() || stages.length === 0) return;
    customMutation.mutate(
      { goalId: goalId.trim(), stages },
      {
        onSuccess: (data) => {
          handleClose();
          navigate(`/dashboard/pipelines/${data.jobId}`);
        },
      },
    );
  }

  function addStage() {
    setStages((prev) => [
      ...prev,
      { agent: "coder", prompt: "", dependsOnPrevious: true },
    ]);
  }

  function removeStage(index: number) {
    setStages((prev) => prev.filter((_, i) => i !== index));
  }

  function updateStage(index: number, updates: Partial<StageInput>) {
    setStages((prev) =>
      prev.map((stage, i) => (i === index ? { ...stage, ...updates } : stage)),
    );
  }

  const isGoalSubmitDisabled = !goalId.trim() || goalMutation.isPending;
  const isCustomSubmitDisabled =
    !goalId.trim() || stages.length === 0 || customMutation.isPending;

  return (
    <Dialog open={open} onClose={handleClose} className="max-w-lg">
      <DialogHeader>
        <DialogTitle>Run Pipeline</DialogTitle>
        <DialogDescription>
          Submit a pipeline to run multi-stage agent workflows.
        </DialogDescription>
      </DialogHeader>

      {/* Mode toggle */}
      <div className="mb-4 flex gap-1 rounded-lg bg-muted p-1">
        <button
          type="button"
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            mode === "goal"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setMode("goal")}
        >
          Goal Pipeline
        </button>
        <button
          type="button"
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            mode === "custom"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setMode("custom")}
        >
          Custom Pipeline
        </button>
      </div>

      {mode === "goal" ? (
        <form onSubmit={handleGoalSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="pipeline-goal-id">
              Goal ID
            </label>
            <Input
              id="pipeline-goal-id"
              value={goalId}
              onChange={(e) => setGoalId(e.target.value)}
              placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isGoalSubmitDisabled}>
              {goalMutation.isPending ? "Submitting..." : "Submit"}
            </Button>
          </DialogFooter>
        </form>
      ) : (
        <form onSubmit={handleCustomSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="custom-pipeline-goal-id">
              Goal ID
            </label>
            <Input
              id="custom-pipeline-goal-id"
              value={goalId}
              onChange={(e) => setGoalId(e.target.value)}
              placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
              required
            />
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium">Stages</label>
            {stages.map((stage, index) => (
              <div
                key={index}
                className="rounded-md border bg-muted/30 p-3 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground w-14 shrink-0">
                    Stage {index + 1}
                  </span>
                  <Select
                    value={stage.agent}
                    onChange={(e) =>
                      updateStage(index, { agent: e.target.value as PipelineAgentRole })
                    }
                    className="flex-1"
                  >
                    {AGENT_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role.charAt(0).toUpperCase() + role.slice(1)}
                      </option>
                    ))}
                  </Select>
                  <button
                    type="button"
                    onClick={() => removeStage(index)}
                    disabled={stages.length <= 1}
                    className="text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    aria-label={`Remove stage ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <Textarea
                  value={stage.prompt}
                  onChange={(e) => updateStage(index, { prompt: e.target.value })}
                  placeholder="Instructions for this stage..."
                  rows={2}
                />
                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={stage.dependsOnPrevious}
                    onChange={(e) =>
                      updateStage(index, { dependsOnPrevious: e.target.checked })
                    }
                    className="rounded"
                  />
                  Depends on previous
                </label>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addStage}
              className="w-full"
            >
              <Plus className="mr-1 h-4 w-4" />
              Add Stage
            </Button>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isCustomSubmitDisabled}>
              {customMutation.isPending ? "Submitting..." : "Submit"}
            </Button>
          </DialogFooter>
        </form>
      )}
    </Dialog>
  );
}
