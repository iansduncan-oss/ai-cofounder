import { useState } from "react";
import { ListTodo, Plus, Check, X, Trash2, Clock } from "lucide-react";
import { useFollowUps } from "@/api/queries";
import { useCreateFollowUp, useUpdateFollowUp, useDeleteFollowUp } from "@/api/mutations";
import type { FollowUpStatus } from "@ai-cofounder/api-client";

const STATUS_TABS: { label: string; value: FollowUpStatus | undefined }[] = [
  { label: "Pending", value: "pending" },
  { label: "Done", value: "done" },
  { label: "Dismissed", value: "dismissed" },
];

export function FollowUpsPage() {
  const [activeTab, setActiveTab] = useState<FollowUpStatus | undefined>("pending");
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");

  const { data, isLoading } = useFollowUps(activeTab);
  const createMutation = useCreateFollowUp();
  const updateMutation = useUpdateFollowUp();
  const deleteMutation = useDeleteFollowUp();

  const handleCreate = () => {
    if (!title.trim()) return;
    createMutation.mutate(
      { title: title.trim(), description: description.trim() || undefined, dueDate: dueDate || undefined },
      {
        onSuccess: () => {
          setTitle("");
          setDescription("");
          setDueDate("");
          setShowCreate(false);
        },
      },
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ListTodo className="h-5 w-5" />
          <h1 className="text-xl font-semibold">Follow-ups</h1>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> New
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.label}
            onClick={() => setActiveTab(tab.value)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === tab.value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Create dialog */}
      {showCreate && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <input
            type="text"
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            autoFocus
          />
          <textarea
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
          <input
            type="datetime-local"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!title.trim() || createMutation.isPending}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Create
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : !data?.data?.length ? (
        <p className="text-sm text-muted-foreground">No follow-ups found.</p>
      ) : (
        <div className="space-y-2">
          {data.data.map((item) => (
            <div key={item.id} className="flex items-start justify-between rounded-lg border bg-card p-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{item.title}</p>
                {item.description && (
                  <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{item.description}</p>
                )}
                {item.dueDate && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    Due {new Date(item.dueDate).toLocaleDateString()}
                  </p>
                )}
                {item.source && (
                  <span className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                    {item.source}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 ml-2">
                {item.status === "pending" && (
                  <>
                    <button
                      onClick={() => updateMutation.mutate({ id: item.id, data: { status: "done" } })}
                      className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-emerald-600"
                      title="Mark done"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => updateMutation.mutate({ id: item.id, data: { status: "dismissed" } })}
                      className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-amber-600"
                      title="Dismiss"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </>
                )}
                <button
                  onClick={() => deleteMutation.mutate(item.id)}
                  className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
