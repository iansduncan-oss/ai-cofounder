import { useState } from "react";
import { useKnowledgeStatus, useKnowledgeSearch } from "@/api/queries";
import { useRagDeleteSource } from "@/api/mutations";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ListSkeleton } from "@/components/common/loading-skeleton";
import { usePageTitle } from "@/hooks/use-page-title";
import { formatDate } from "@/lib/utils";
import { Library, Search, Trash2, Database } from "lucide-react";

export function KnowledgePage() {
  usePageTitle("Knowledge Base");
  const { data: statusData, isLoading } = useKnowledgeStatus();
  const deleteMutation = useRagDeleteSource();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const { data: searchData, isLoading: searching } = useKnowledgeSearch(activeSearch);
  const searchResults = (searchData as { results?: Array<Record<string, unknown>> })?.results ?? [];
  const [deleteTarget, setDeleteTarget] = useState<{ type: string; id: string } | null>(null);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setActiveSearch(searchQuery);
  };

  return (
    <div>
      <PageHeader title="Knowledge Base" description="RAG document store and semantic search" />

      {/* Status Cards */}
      {statusData && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">Total Chunks</p>
            <p className="text-lg font-semibold">{statusData.totalChunks.toLocaleString()}</p>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">Sources</p>
            <p className="text-lg font-semibold">{statusData.sources.length}</p>
          </div>
        </div>
      )}

      {/* Search */}
      <form onSubmit={handleSearch} className="mb-6">
        <div className="relative max-w-lg">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search knowledge base..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </form>

      {/* Search Results */}
      {activeSearch && (
        <div className="mb-6">
          <h2 className="mb-3 text-sm font-medium">
            Search results for &ldquo;{activeSearch}&rdquo;
          </h2>
          {searching ? (
            <ListSkeleton rows={3} />
          ) : searchResults.length === 0 ? (
            <p className="text-sm text-muted-foreground">No results found.</p>
          ) : (
            <div className="space-y-2">
              {searchResults.map((r, i) => (
                <Card key={i}>
                  <CardContent className="pt-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm line-clamp-3">
                          {(r.content as string) ?? (r.text as string) ?? JSON.stringify(r)}
                        </p>
                      </div>
                      {r.score != null && (
                        <Badge variant="outline" className="shrink-0 text-xs">
                          {(r.score as number).toFixed(2)}
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sources */}
      <h2 className="mb-3 text-sm font-medium">Sources</h2>
      {isLoading ? (
        <ListSkeleton rows={3} />
      ) : !statusData?.sources.length ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Library className="mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">No knowledge sources ingested</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Ingest documents via the API or agent tools.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {statusData.sources.map((s) => {
            const src = s as Record<string, unknown>;
            const type = (src.type ?? src.sourceType ?? "unknown") as string;
            const id = (src.id ?? src.sourceId ?? "unknown") as string;
            const chunkCount = (src.chunkCount ?? 0) as number;
            const lastIngested = src.lastIngested as string | null;
            return (
              <Card key={`${type}-${id}`}>
                <CardContent className="pt-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Database className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">{type}</Badge>
                          <span className="text-sm font-medium">{id}</span>
                        </div>
                        <div className="mt-0.5 flex gap-3 text-xs text-muted-foreground">
                          <span>{chunkCount} chunks</span>
                          {lastIngested && <span>Last: {formatDate(lastIngested)}</span>}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget({ type, id })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation */}
      <Dialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)}>
        <DialogHeader>
          <DialogTitle>Delete this source?</DialogTitle>
        </DialogHeader>
        <p className="py-4 text-sm text-muted-foreground">
          This will delete all chunks from source &ldquo;{deleteTarget?.id}&rdquo;. This action cannot be undone.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={deleteMutation.isPending}
            onClick={() => {
              if (!deleteTarget) return;
              deleteMutation.mutate(
                { sourceType: deleteTarget.type, sourceId: deleteTarget.id },
                { onSuccess: () => setDeleteTarget(null) },
              );
            }}
          >
            {deleteMutation.isPending ? "Deleting..." : "Yes, Delete"}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
