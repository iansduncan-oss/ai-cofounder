import { useState } from "react";
import { useListPersonas, useActivePersona } from "@/api/queries";
import { useUpsertPersona, useDeletePersona } from "@/api/mutations";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { AlertTriangle, Plus, Pencil, Trash2, Check } from "lucide-react";
import type { Persona, UpsertPersonaInput } from "@ai-cofounder/api-client";

const emptyForm: UpsertPersonaInput = {
  name: "",
  corePersonality: "",
  voiceId: "",
  capabilities: "",
  behavioralGuidelines: "",
  isActive: false,
};

export function PersonaPage() {
  usePageTitle("Persona");
  const { data, isLoading, error } = useListPersonas();
  const { data: activeData } = useActivePersona();
  const upsertMutation = useUpsertPersona();
  const deleteMutation = useDeletePersona();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Persona | null>(null);
  const [form, setForm] = useState<UpsertPersonaInput>(emptyForm);
  const [editingId, setEditingId] = useState<string | undefined>();

  const personas = data?.personas ?? [];
  const activePersonaId = activeData?.persona?.id;

  function openCreate() {
    setForm(emptyForm);
    setEditingId(undefined);
    setDialogOpen(true);
  }

  function openEdit(p: Persona) {
    setForm({
      id: p.id,
      name: p.name,
      corePersonality: p.corePersonality,
      voiceId: p.voiceId ?? "",
      capabilities: p.capabilities ?? "",
      behavioralGuidelines: p.behavioralGuidelines ?? "",
      isActive: p.isActive,
    });
    setEditingId(p.id);
    setDialogOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    upsertMutation.mutate(
      { ...form, id: editingId },
      { onSuccess: () => setDialogOpen(false) },
    );
  }

  function handleActivate(p: Persona) {
    upsertMutation.mutate({
      id: p.id,
      name: p.name,
      corePersonality: p.corePersonality,
      voiceId: p.voiceId ?? undefined,
      capabilities: p.capabilities ?? undefined,
      behavioralGuidelines: p.behavioralGuidelines ?? undefined,
      isActive: true,
    });
  }

  function confirmDelete(p: Persona) {
    setDeleteTarget(p);
    setDeleteDialogOpen(true);
  }

  function handleDelete() {
    if (!deleteTarget) return;
    deleteMutation.mutate(deleteTarget.id, {
      onSuccess: () => setDeleteDialogOpen(false),
    });
  }

  return (
    <div>
      <PageHeader
        title="Persona"
        description="Manage AI personality, voice, and behavioral guidelines"
        actions={
          <Button onClick={openCreate} size="sm">
            <Plus className="mr-1 h-4 w-4" />
            New Persona
          </Button>
        }
      />

      <div className="space-y-4">
        {isLoading ? (
          <ListSkeleton rows={3} />
        ) : error ? (
          <Card>
            <CardContent className="py-6">
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4" />
                <span>Failed to load personas: {error.message}</span>
              </div>
            </CardContent>
          </Card>
        ) : personas.length === 0 ? (
          <EmptyState
            title="No personas yet"
            description="Create a persona to customize the AI's personality and voice."
            action={
              <Button onClick={openCreate} size="sm">
                <Plus className="mr-1 h-4 w-4" />
                Create Persona
              </Button>
            }
          />
        ) : (
          personas.map((p) => (
            <Card key={p.id}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">{p.name}</CardTitle>
                  {p.id === activePersonaId && (
                    <Badge variant="success">Active</Badge>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {p.id !== activePersonaId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleActivate(p)}
                      disabled={upsertMutation.isPending}
                      title="Set as active"
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEdit(p)}
                    title="Edit"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => confirmDelete(p)}
                    disabled={deleteMutation.isPending}
                    title="Delete"
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Personality: </span>
                    <span className="line-clamp-2">{p.corePersonality}</span>
                  </div>
                  {p.voiceId && (
                    <div>
                      <span className="text-muted-foreground">Voice ID: </span>
                      <code className="rounded bg-muted px-1 py-0.5 text-xs">
                        {p.voiceId}
                      </code>
                    </div>
                  )}
                  {p.capabilities && (
                    <div>
                      <span className="text-muted-foreground">Capabilities: </span>
                      <span className="line-clamp-1">{p.capabilities}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)}>
        <DialogHeader>
          <DialogTitle>{editingId ? "Edit Persona" : "New Persona"}</DialogTitle>
          <DialogDescription>
            {editingId
              ? "Update the persona's personality and settings."
              : "Create a new AI persona with custom personality."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium" htmlFor="persona-name">
              Name
            </label>
            <Input
              id="persona-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. JARVIS"
              required
            />
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="persona-personality">
              Core Personality
            </label>
            <Textarea
              id="persona-personality"
              value={form.corePersonality}
              onChange={(e) =>
                setForm({ ...form, corePersonality: e.target.value })
              }
              placeholder="Describe the AI's personality and tone..."
              rows={3}
              required
            />
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="persona-voice">
              ElevenLabs Voice ID
            </label>
            <Input
              id="persona-voice"
              value={form.voiceId ?? ""}
              onChange={(e) => setForm({ ...form, voiceId: e.target.value })}
              placeholder="Optional — leave blank for default"
            />
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="persona-capabilities">
              Capabilities
            </label>
            <Textarea
              id="persona-capabilities"
              value={form.capabilities ?? ""}
              onChange={(e) =>
                setForm({ ...form, capabilities: e.target.value })
              }
              placeholder="What this persona can do..."
              rows={2}
            />
          </div>
          <div>
            <label
              className="text-sm font-medium"
              htmlFor="persona-guidelines"
            >
              Behavioral Guidelines
            </label>
            <Textarea
              id="persona-guidelines"
              value={form.behavioralGuidelines ?? ""}
              onChange={(e) =>
                setForm({ ...form, behavioralGuidelines: e.target.value })
              }
              placeholder="Rules and guidelines for behavior..."
              rows={2}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="persona-active"
              checked={form.isActive ?? false}
              onChange={(e) =>
                setForm({ ...form, isActive: e.target.checked })
              }
              className="h-4 w-4 rounded border-input"
            />
            <label className="text-sm" htmlFor="persona-active">
              Set as active persona
            </label>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={upsertMutation.isPending}>
              {upsertMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogHeader>
          <DialogTitle>Delete Persona</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete &ldquo;{deleteTarget?.name}&rdquo;?
            This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setDeleteDialogOpen(false)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
