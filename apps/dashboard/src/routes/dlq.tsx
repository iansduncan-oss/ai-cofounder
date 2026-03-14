import { useState } from "react";
import { useDlqJobs } from "@/api/queries";
import { useRetryDlqJob, useDeleteDlqJob } from "@/api/mutations";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ListSkeleton } from "@/components/common/loading-skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { RelativeTime } from "@/components/common/relative-time";
import { usePageTitle } from "@/hooks/use-page-title";
import { AlertTriangle, RefreshCw, Trash2, Inbox } from "lucide-react";
import type { DeadLetterEntry } from "@ai-cofounder/api-client";

export function DlqPage() {
  usePageTitle("Dead Letter Queue");
  const { data, isLoading, error } = useDlqJobs();
  const retryMutation = useRetryDlqJob();
  const deleteMutation = useDeleteDlqJob();

  const [deleteTarget, setDeleteTarget] = useState<DeadLetterEntry | null>(null);

  const jobs = data?.jobs ?? [];
  const uniqueQueues = new Set(jobs.map((j) => j.originalQueue));

  function handleDelete() {
    if (!deleteTarget) return;
    deleteMutation.mutate(deleteTarget.dlqJobId, {
      onSuccess: () => setDeleteTarget(null),
    });
  }

  return (
    <div>
      <PageHeader
        title="Dead Letter Queue"
        description="Failed jobs that exceeded retry limits"
      />

      {error ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <AlertTriangle className="mb-3 h-8 w-8 text-destructive" />
          <p className="text-sm font-medium">Failed to load DLQ</p>
          <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>
        </div>
      ) : isLoading ? (
        <ListSkeleton rows={3} />
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-10 w-10" />}
          title="No dead letter jobs"
          description="All jobs are processing normally. Failed jobs that exceed retry limits will appear here."
        />
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid gap-4 sm:grid-cols-2 mb-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  Total DLQ Jobs
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{jobs.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  Queues Affected
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{uniqueQueues.size}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {[...uniqueQueues].map((q) => (
                    <Badge key={q} variant="secondary" className="text-[10px]">
                      {q}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Table */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-4 py-3 font-medium">Queue</th>
                      <th className="px-4 py-3 font-medium">Job Name</th>
                      <th className="px-4 py-3 font-medium">Failed Reason</th>
                      <th className="px-4 py-3 font-medium text-center">Attempts</th>
                      <th className="px-4 py-3 font-medium">Failed At</th>
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {jobs.map((job) => (
                      <tr key={job.dlqJobId} className="hover:bg-accent/50 transition-colors">
                        <td className="px-4 py-3">
                          <Badge variant="outline">{job.originalQueue}</Badge>
                        </td>
                        <td className="px-4 py-3 font-medium">{job.originalJobName}</td>
                        <td className="px-4 py-3 max-w-xs truncate text-muted-foreground" title={job.failedReason}>
                          {job.failedReason}
                        </td>
                        <td className="px-4 py-3 text-center tabular-nums">{job.attemptsMade}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          <RelativeTime date={job.failedAt} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => retryMutation.mutate(job.dlqJobId)}
                              disabled={retryMutation.isPending}
                              title="Retry"
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDeleteTarget(job)}
                              disabled={deleteMutation.isPending}
                              title="Delete"
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Delete Confirmation */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <DialogHeader>
          <DialogTitle>Delete Dead Letter Job</DialogTitle>
          <DialogDescription>
            Are you sure you want to permanently delete this failed job? This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {deleteTarget && (
          <div className="mb-4 rounded-md bg-muted p-3 text-xs">
            <p><span className="font-medium">Queue:</span> {deleteTarget.originalQueue}</p>
            <p><span className="font-medium">Job:</span> {deleteTarget.originalJobName}</p>
            <p className="mt-1 text-muted-foreground truncate">{deleteTarget.failedReason}</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
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
