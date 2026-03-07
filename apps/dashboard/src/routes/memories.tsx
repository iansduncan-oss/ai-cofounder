import { useState } from "react";
import { useMemories } from "@/api/queries";
import { useDeleteMemory } from "@/api/mutations";
import { PageHeader } from "@/components/layout/page-header";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ListSkeleton } from "@/components/common/loading-skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { RelativeTime } from "@/components/common/relative-time";
import { usePageTitle } from "@/hooks/use-page-title";
import {
  Brain,
  Search,
  AlertTriangle,
  Trash2,
  Star,
  Eye,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export function MemoriesPage() {
  usePageTitle("Memories");
  const [userId, setUserId] = useState("default");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const { data: memories, isLoading, error } = useMemories(userId);
  const deleteMemory = useDeleteMemory();

  const categories = memories
    ? [...new Set(memories.map((m) => m.category))].sort()
    : [];

  const filtered = memories?.filter((m) => {
    if (categoryFilter !== "all" && m.category !== categoryFilter) return false;
    if (
      search &&
      !m.key.toLowerCase().includes(search.toLowerCase()) &&
      !m.content.toLowerCase().includes(search.toLowerCase())
    )
      return false;
    return true;
  });

  const grouped = filtered?.reduce(
    (acc, m) => {
      (acc[m.category] ??= []).push(m);
      return acc;
    },
    {} as Record<string, typeof filtered>,
  );

  return (
    <div>
      <PageHeader
        title="Memories"
        description="Semantic memories stored by agents"
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search memories..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-60 pl-8"
          />
        </div>
        <Input
          placeholder="User ID"
          value={userId}
          onChange={(e) => setUserId(e.target.value || "default")}
          className="w-48"
        />
        <Select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="w-40"
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </div>

      {error ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <AlertTriangle className="mb-3 h-8 w-8 text-destructive" />
          <p className="text-sm font-medium">Failed to load memories</p>
          <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>
        </div>
      ) : isLoading ? (
        <ListSkeleton rows={5} />
      ) : grouped && Object.keys(grouped).length > 0 ? (
        <div className="space-y-6">
          {Object.entries(grouped)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([category, items]) => (
              <div key={category}>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  <Badge variant="secondary">{category}</Badge>
                  <span className="text-xs font-normal">
                    {items!.length} {items!.length === 1 ? "memory" : "memories"}
                  </span>
                </h2>
                <div className="space-y-2">
                  {items!.map((memory) => (
                    <div
                      key={memory.id}
                      className="group rounded-lg border bg-card p-4 transition-all hover:bg-accent"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-medium">{memory.key}</h3>
                          <p className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap line-clamp-4">
                            {memory.content}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Star className="h-3 w-3" />
                              {memory.importance}/10
                            </span>
                            <span className="flex items-center gap-1">
                              <Eye className="h-3 w-3" />
                              {memory.accessCount} accesses
                            </span>
                            {memory.source && (
                              <span>source: {memory.source}</span>
                            )}
                            <RelativeTime date={memory.updatedAt} />
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-2 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(memory.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      ) : (
        <EmptyState
          icon={<Brain className="h-10 w-10" />}
          title="No memories found"
          description={
            search || categoryFilter !== "all"
              ? "Try adjusting your filters"
              : "Memories will appear here as agents learn"
          }
        />
      )}

      <Dialog
        open={!!deleteTarget}
        onOpenChange={() => setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete memory?</DialogTitle>
            <DialogDescription>
              This will permanently remove this memory. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteTarget) {
                  deleteMemory.mutate(deleteTarget);
                  setDeleteTarget(null);
                }
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
