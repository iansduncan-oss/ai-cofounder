import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CardSkeleton } from "@/components/common/loading-skeleton";
import { RelativeTime } from "@/components/common/relative-time";
import { usePageTitle } from "@/hooks/use-page-title";
import { useWorkspace } from "@/hooks/use-workspace";
import { apiClient } from "@/api/client";
import { queryKeys } from "@/lib/query-keys";
import { FolderOpen, Plus, Trash2, Check, AlertTriangle } from "lucide-react";

export function WorkspacesPage() {
  usePageTitle("Workspaces");
  const queryClient = useQueryClient();
  const { currentWorkspaceId, switchWorkspace } = useWorkspace();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.workspaces.list,
    queryFn: () => apiClient.listWorkspaces(),
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; slug: string }) => apiClient.createWorkspace(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.list });
      setShowCreate(false);
      setNewName("");
      setNewSlug("");
      setError(null);
    },
    onError: (err: Error) => setError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.deleteWorkspace(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.list });
    },
  });

  const workspaces = data?.workspaces ?? [];

  return (
    <div>
      <PageHeader
        title="Workspaces"
        description="Manage your workspaces to separate different projects and contexts"
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {workspaces.map((ws) => (
              <Card
                key={ws.id}
                className={ws.id === currentWorkspaceId ? "border-primary" : ""}
              >
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <FolderOpen className="h-4 w-4" />
                    {ws.name}
                  </CardTitle>
                  <div className="flex items-center gap-1">
                    {ws.isDefault && <Badge variant="secondary">Default</Badge>}
                    {ws.id === currentWorkspaceId && (
                      <Badge variant="default" className="bg-primary/15 text-primary border-primary/20">Active</Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-xs text-muted-foreground">
                    <span className="font-mono">{ws.slug}</span>
                    <span className="mx-2">·</span>
                    Created <RelativeTime date={ws.createdAt} />
                  </div>
                  <div className="flex items-center gap-2">
                    {ws.id !== currentWorkspaceId && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => switchWorkspace(ws.id)}
                      >
                        <Check className="mr-1 h-3 w-3" />
                        Switch
                      </Button>
                    )}
                    {!ws.isDefault && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => {
                          if (confirm(`Delete workspace "${ws.name}"? This will delete all data in it.`)) {
                            deleteMutation.mutate(ws.id);
                          }
                        }}
                      >
                        <Trash2 className="mr-1 h-3 w-3" />
                        Delete
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}

            {/* Create new workspace card */}
            {!showCreate ? (
              <Card
                className="cursor-pointer border-dashed hover:border-primary/50 transition-colors"
                onClick={() => setShowCreate(true)}
              >
                <CardContent className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <Plus className="mb-2 h-6 w-6" />
                  <span className="text-sm font-medium">New Workspace</span>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">New Workspace</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Input
                    placeholder="Workspace name"
                    value={newName}
                    onChange={(e) => {
                      setNewName(e.target.value);
                      setNewSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
                    }}
                    autoFocus
                  />
                  <Input
                    placeholder="slug"
                    value={newSlug}
                    onChange={(e) => setNewSlug(e.target.value)}
                    className="font-mono text-xs"
                  />
                  {error && (
                    <p className="flex items-center gap-1 text-xs text-destructive">
                      <AlertTriangle className="h-3 w-3" />
                      {error}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={!newName || !newSlug || createMutation.isPending}
                      onClick={() => createMutation.mutate({ name: newName, slug: newSlug })}
                    >
                      Create
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setShowCreate(false); setError(null); }}
                    >
                      Cancel
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}
