import { useState } from "react";
import { usePipelineTemplates } from "@/api/queries";
import { useTriggerPipelineTemplate, useCreatePipelineTemplate, useDeletePipelineTemplate } from "@/api/mutations";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ListSkeleton } from "@/components/common/loading-skeleton";
import { usePageTitle } from "@/hooks/use-page-title";
import { formatDate } from "@/lib/utils";
import { LayoutTemplate, Play, Plus, Trash2, ChevronDown, ChevronUp, GripVertical } from "lucide-react";

const AGENT_OPTIONS = ["planner", "coder", "reviewer", "debugger", "researcher"] as const;

interface StageInput {
  agent: string;
  prompt: string;
  dependsOnPrevious: boolean;
}

const emptyStage = (): StageInput => ({ agent: "planner", prompt: "", dependsOnPrevious: true });

export function PipelineTemplatesPage() {
  usePageTitle("Pipeline Templates");
  const { data: templates, isLoading } = usePipelineTemplates();
  const trigger = useTriggerPipelineTemplate();
  const createMutation = useCreatePipelineTemplate();
  const deleteMutation = useDeletePipelineTemplate();

  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [stages, setStages] = useState<StageInput[]>([emptyStage()]);

  const resetForm = () => {
    setName("");
    setDescription("");
    setStages([emptyStage()]);
  };

  const updateStage = (index: number, patch: Partial<StageInput>) => {
    setStages((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const removeStage = (index: number) => {
    setStages((prev) => prev.filter((_, i) => i !== index));
  };

  const moveStage = (index: number, direction: -1 | 1) => {
    setStages((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const handleCreate = () => {
    createMutation.mutate(
      { name, description: description || undefined, stages },
      { onSuccess: () => { setShowCreate(false); resetForm(); } },
    );
  };

  const canCreate = name.trim() && stages.length > 0 && stages.every((s) => s.prompt.trim());

  return (
    <div>
      <PageHeader
        title="Pipeline Templates"
        description="Reusable multi-agent pipeline configurations"
        actions={
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            New Template
          </Button>
        }
      />

      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : !templates || templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <LayoutTemplate className="mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">No pipeline templates</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Create templates to define reusable pipeline configurations.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((t) => (
            <Card key={t.id}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{t.name}</p>
                      <Badge variant={t.isActive ? "default" : "secondary"}>
                        {t.isActive ? "Active" : "Inactive"}
                      </Badge>
                      <Badge variant="outline">{(t.stages as unknown[]).length} stages</Badge>
                    </div>
                    {t.description && (
                      <p className="mt-1 text-sm text-muted-foreground">{t.description}</p>
                    )}
                    {/* Stage summary */}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(t.stages as Array<{ agent: string }>).map((s, i) => (
                        <Badge key={i} variant="outline" className="text-xs">
                          {i + 1}. {s.agent}
                        </Badge>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Created {formatDate(t.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!t.isActive || trigger.isPending}
                      onClick={() => trigger.mutate({ name: t.name })}
                    >
                      <Play className="mr-1 h-3 w-3" />
                      Trigger
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(t.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreate} onClose={() => { setShowCreate(false); resetForm(); }}>
        <DialogHeader>
          <DialogTitle>Create Pipeline Template</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto py-4">
          <div>
            <label className="mb-1 block text-xs font-medium">Template Name</label>
            <input
              type="text"
              placeholder="e.g., code-review-pipeline"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Description (optional)</label>
            <input
              type="text"
              placeholder="What does this pipeline do?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-medium">Stages</label>
              <Button variant="outline" size="sm" onClick={() => setStages((s) => [...s, emptyStage()])}>
                <Plus className="mr-1 h-3 w-3" />
                Add Stage
              </Button>
            </div>
            <div className="space-y-3">
              {stages.map((stage, i) => (
                <div key={i} className="rounded-md border bg-muted/30 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <GripVertical className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs font-medium">Stage {i + 1}</span>
                    <select
                      value={stage.agent}
                      onChange={(e) => updateStage(i, { agent: e.target.value })}
                      className="rounded-md border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {AGENT_OPTIONS.map((a) => (
                        <option key={a} value={a}>{a}</option>
                      ))}
                    </select>
                    <div className="flex-1" />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => moveStage(i, -1)}
                      disabled={i === 0}
                      className="h-6 w-6 p-0"
                    >
                      <ChevronUp className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => moveStage(i, 1)}
                      disabled={i === stages.length - 1}
                      className="h-6 w-6 p-0"
                    >
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                    {stages.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                        onClick={() => removeStage(i)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                  <textarea
                    rows={2}
                    placeholder="What should this agent do?"
                    value={stage.prompt}
                    onChange={(e) => updateStage(i, { prompt: e.target.value })}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <label className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={stage.dependsOnPrevious}
                      onChange={(e) => updateStage(i, { dependsOnPrevious: e.target.checked })}
                      className="rounded"
                    />
                    Depends on previous stage output
                  </label>
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setShowCreate(false); resetForm(); }}>Cancel</Button>
          <Button onClick={handleCreate} disabled={!canCreate || createMutation.isPending}>
            {createMutation.isPending ? "Creating..." : `Create (${stages.length} stage${stages.length !== 1 ? "s" : ""})`}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)}>
        <DialogHeader>
          <DialogTitle>Delete this template?</DialogTitle>
        </DialogHeader>
        <p className="py-4 text-sm text-muted-foreground">
          This will permanently remove the template. This action cannot be undone.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={deleteMutation.isPending}
            onClick={() => {
              if (!deleteTarget) return;
              deleteMutation.mutate(deleteTarget, {
                onSuccess: () => setDeleteTarget(null),
              });
            }}
          >
            {deleteMutation.isPending ? "Deleting..." : "Yes, Delete"}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
