import { useState, useMemo, useEffect } from "react";
import { useDirectoryListing, useFileContent, useProjects } from "@/api/queries";
import { useActiveProject } from "@/hooks/use-active-project";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { ListSkeleton } from "@/components/common/loading-skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { usePageTitle } from "@/hooks/use-page-title";
import { FolderOpen, File, Folder, ChevronRight, AlertTriangle, X } from "lucide-react";

export function WorkspacePage() {
  usePageTitle("Workspace");
  const [currentPath, setCurrentPath] = useState(".");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const activeProjectId = useActiveProject();
  const { data: projects } = useProjects();

  const workspaceRoot = useMemo(() => {
    if (!activeProjectId || !projects) return ".";
    const project = projects.find((p) => p.id === activeProjectId);
    return project?.workspacePath ?? ".";
  }, [activeProjectId, projects]);

  const activeProjectName = useMemo(() => {
    if (!activeProjectId || !projects) return null;
    return projects.find((p) => p.id === activeProjectId)?.name ?? null;
  }, [activeProjectId, projects]);

  useEffect(() => {
    setCurrentPath(workspaceRoot);
    setSelectedFile(null);
  }, [workspaceRoot]);

  const { data: listing, isLoading, error } = useDirectoryListing(currentPath);
  const { data: fileData, isLoading: fileLoading } = useFileContent(selectedFile);

  const breadcrumbs = currentPath === "." ? [] : currentPath.split("/");

  const navigateTo = (path: string) => {
    setCurrentPath(path);
    setSelectedFile(null);
  };

  const handleEntryClick = (name: string, type: "file" | "directory") => {
    const fullPath = currentPath === "." ? name : `${currentPath}/${name}`;
    if (type === "directory") {
      navigateTo(fullPath);
    } else {
      setSelectedFile(fullPath);
    }
  };

  const _extToLang: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    md: "markdown",
    yml: "yaml",
    yaml: "yaml",
    sh: "bash",
    py: "python",
    sql: "sql",
    css: "css",
    html: "html",
  };

  const _getFileExt = (name: string) => name.split(".").pop() ?? "";

  return (
    <div>
      <PageHeader
        title="Workspace"
        description={
          activeProjectName
            ? `Project: ${activeProjectName}`
            : "Browse workspace files and repositories"
        }
      />

      {/* Breadcrumbs */}
      <div className="mb-4 flex items-center gap-1 text-sm">
        <button className="text-primary hover:underline" onClick={() => navigateTo(".")}>
          workspace
        </button>
        {breadcrumbs.map((part, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
            <button
              className="text-primary hover:underline"
              onClick={() => navigateTo(breadcrumbs.slice(0, i + 1).join("/"))}
            >
              {part}
            </button>
          </span>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Directory listing */}
        <div>
          {error ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <AlertTriangle className="mb-3 h-8 w-8 text-destructive" />
              <p className="text-sm font-medium">Failed to load directory</p>
              <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>
            </div>
          ) : isLoading ? (
            <ListSkeleton rows={8} />
          ) : listing && listing.entries.length > 0 ? (
            <div className="rounded-lg border bg-card divide-y">
              {currentPath !== "." && (
                <button
                  className="flex w-full items-center gap-3 px-3 py-2 text-sm hover:bg-accent transition-colors"
                  onClick={() => {
                    const parts = currentPath.split("/");
                    parts.pop();
                    navigateTo(parts.length ? parts.join("/") : ".");
                  }}
                >
                  <Folder className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">..</span>
                </button>
              )}
              {[...listing.entries]
                .sort((a, b) => {
                  if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
                  return a.name.localeCompare(b.name);
                })
                .map((entry) => (
                  <button
                    key={entry.name}
                    className="flex w-full items-center gap-3 px-3 py-2 text-sm hover:bg-accent transition-colors"
                    onClick={() => handleEntryClick(entry.name, entry.type)}
                  >
                    {entry.type === "directory" ? (
                      <Folder className="h-4 w-4 text-blue-400" />
                    ) : (
                      <File className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="flex-1 text-left truncate">{entry.name}</span>
                    {entry.type === "file" && entry.size != null && (
                      <span className="text-xs text-muted-foreground">
                        {entry.size < 1024
                          ? `${entry.size} B`
                          : `${(entry.size / 1024).toFixed(1)} KB`}
                      </span>
                    )}
                  </button>
                ))}
            </div>
          ) : (
            <EmptyState
              icon={<FolderOpen className="h-10 w-10" />}
              title="Empty directory"
              description="This directory has no files"
            />
          )}
        </div>

        {/* File viewer */}
        <div>
          {selectedFile ? (
            <div className="rounded-lg border bg-card">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <span className="text-xs font-mono text-muted-foreground truncate">
                  {selectedFile}
                </span>
                <Button variant="ghost" size="sm" onClick={() => setSelectedFile(null)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              {fileLoading ? (
                <div className="p-4">
                  <ListSkeleton rows={10} />
                </div>
              ) : fileData ? (
                <pre className="overflow-auto p-4 text-xs leading-relaxed max-h-[70vh]">
                  <code>{fileData.content}</code>
                </pre>
              ) : (
                <p className="p-4 text-xs text-muted-foreground">Unable to read file</p>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center rounded-lg border border-dashed py-20 text-center">
              <p className="text-sm text-muted-foreground">Select a file to view its contents</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
