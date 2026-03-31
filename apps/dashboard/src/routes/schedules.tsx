import { useState } from "react";
import { useSchedules } from "@/api/queries";
import { useCreateSchedule, useToggleSchedule, useDeleteSchedule } from "@/api/mutations";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ListSkeleton } from "@/components/common/loading-skeleton";
import { usePageTitle } from "@/hooks/use-page-title";
import { formatDate } from "@/lib/utils";
import { CalendarClock, Plus, Trash2, ToggleLeft, ToggleRight } from "lucide-react";

export function SchedulesPage() {
  usePageTitle("Schedules");
  const { data, isLoading } = useSchedules();
  const schedules = data ?? [];
  const createMutation = useCreateSchedule();
  const toggleMutation = useToggleSchedule();
  const deleteMutation = useDeleteSchedule();
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [form, setForm] = useState({ cronExpression: "", actionPrompt: "", description: "" });

  const handleCreate = () => {
    createMutation.mutate(
      { cronExpression: form.cronExpression, actionPrompt: form.actionPrompt, description: form.description || undefined },
      { onSuccess: () => { setShowCreate(false); setForm({ cronExpression: "", actionPrompt: "", description: "" }); } },
    );
  };

  return (
    <div>
      <PageHeader
        title="Schedules"
        description="Cron-based recurring tasks"
        actions={
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            New Schedule
          </Button>
        }
      />

      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : schedules.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <CalendarClock className="mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">No schedules configured</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Create a schedule to run recurring agent tasks.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {schedules.map((s) => (
            <Card key={s.id}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono text-xs">
                        {s.cronExpression}
                      </Badge>
                      <Badge variant={s.enabled ? "default" : "secondary"}>
                        {s.enabled ? "Active" : "Paused"}
                      </Badge>
                    </div>
                    <p className="mt-1.5 text-sm">{s.actionPrompt}</p>
                    {s.description && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{s.description}</p>
                    )}
                    <div className="mt-2 flex gap-3 text-xs text-muted-foreground">
                      {s.lastRunAt && <span>Last: {formatDate(s.lastRunAt)}</span>}
                      <span>Next: {formatDate(s.nextRunAt)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleMutation.mutate({ id: s.id, enabled: !s.enabled })}
                      disabled={toggleMutation.isPending}
                    >
                      {s.enabled ? (
                        <ToggleRight className="h-4 w-4 text-green-600" />
                      ) : (
                        <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(s.id)}
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
      <Dialog open={showCreate} onClose={() => setShowCreate(false)}>
        <DialogHeader>
          <DialogTitle>Create Schedule</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-4">
          <div>
            <label className="mb-1 block text-xs font-medium">Cron Expression</label>
            <input
              type="text"
              placeholder="0 9 * * * (daily at 9am)"
              value={form.cronExpression}
              onChange={(e) => setForm((f) => ({ ...f, cronExpression: e.target.value }))}
              className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Action Prompt</label>
            <textarea
              placeholder="What should the agent do?"
              rows={3}
              value={form.actionPrompt}
              onChange={(e) => setForm((f) => ({ ...f, actionPrompt: e.target.value }))}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Description (optional)</label>
            <input
              type="text"
              placeholder="Short description"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
          <Button
            onClick={handleCreate}
            disabled={!form.cronExpression || !form.actionPrompt || createMutation.isPending}
          >
            {createMutation.isPending ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)}>
        <DialogHeader>
          <DialogTitle>Delete this schedule?</DialogTitle>
        </DialogHeader>
        <p className="py-4 text-sm text-muted-foreground">
          This will permanently remove the schedule. This action cannot be undone.
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
