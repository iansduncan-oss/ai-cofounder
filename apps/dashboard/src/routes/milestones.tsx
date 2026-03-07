import { useState } from "react";
import { useMilestones } from "@/api/queries";
import { useUpdateMilestoneStatus } from "@/api/mutations";
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
  Milestone as MilestoneIcon,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Circle,
  PlayCircle,
  XCircle,
} from "lucide-react";
import type { MilestoneStatus } from "@ai-cofounder/api-client";
import { MilestoneProgressBar } from "@/components/milestones/progress-bar";

const statusConfig: Record<
  MilestoneStatus,
  { icon: typeof Circle; label: string; variant: "default" | "secondary" | "warning" | "destructive" }
> = {
  planned: { icon: Circle, label: "Planned", variant: "secondary" },
  in_progress: { icon: PlayCircle, label: "In Progress", variant: "warning" },
  completed: { icon: CheckCircle2, label: "Completed", variant: "default" },
  cancelled: { icon: XCircle, label: "Cancelled", variant: "destructive" },
};

export function MilestonesPage() {
  usePageTitle("Milestones");
  const [conversationId, setConversationId] = useState("default");
  const [statusFilter, setStatusFilter] = useState<MilestoneStatus | "all">("all");

  const { data: milestones, isLoading, error } = useMilestones(conversationId);
  const updateStatus = useUpdateMilestoneStatus();

  const filtered = milestones?.filter((m) => {
    if (statusFilter !== "all" && m.status !== statusFilter) return false;
    return true;
  });

  return (
    <div>
      <PageHeader
        title="Milestones"
        description="Track project milestones and progress"
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          placeholder="Conversation ID"
          value={conversationId}
          onChange={(e) => setConversationId(e.target.value || "default")}
          className="w-48"
        />
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as MilestoneStatus | "all")}
          className="w-40"
        >
          <option value="all">All statuses</option>
          <option value="planned">Planned</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </Select>
      </div>

      {error ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <AlertTriangle className="mb-3 h-8 w-8 text-destructive" />
          <p className="text-sm font-medium">Failed to load milestones</p>
          <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>
        </div>
      ) : isLoading ? (
        <ListSkeleton rows={4} />
      ) : filtered && filtered.length > 0 ? (
        <div className="space-y-3">
          {filtered
            .sort((a, b) => a.orderIndex - b.orderIndex)
            .map((milestone) => {
              const config = statusConfig[milestone.status];
              const StatusIcon = config.icon;

              return (
                <div
                  key={milestone.id}
                  className="rounded-lg border bg-card p-4 transition-all hover:bg-accent"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <StatusIcon className="h-4 w-4 text-muted-foreground" />
                        <h3 className="text-sm font-medium">{milestone.title}</h3>
                        <Badge variant={config.variant}>{config.label}</Badge>
                      </div>
                      {milestone.description && (
                        <p className="mt-1 ml-6 text-xs text-muted-foreground line-clamp-2">
                          {milestone.description}
                        </p>
                      )}
                      <MilestoneProgressBar milestoneId={milestone.id} />
                      <div className="mt-2 ml-6 flex items-center gap-3 text-xs text-muted-foreground">
                        {milestone.dueDate && (
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            Due {new Date(milestone.dueDate).toLocaleDateString()}
                          </span>
                        )}
                        <RelativeTime date={milestone.createdAt} />
                        {milestone.createdBy && <span>by {milestone.createdBy}</span>}
                      </div>
                    </div>
                    <div className="ml-4 flex gap-1">
                      {milestone.status === "planned" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            updateStatus.mutate({ id: milestone.id, status: "in_progress" })
                          }
                        >
                          Start
                        </Button>
                      )}
                      {milestone.status === "in_progress" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            updateStatus.mutate({ id: milestone.id, status: "completed" })
                          }
                        >
                          Complete
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      ) : (
        <EmptyState
          icon={<MilestoneIcon className="h-10 w-10" />}
          title="No milestones found"
          description={
            statusFilter !== "all"
              ? "Try adjusting your filters"
              : "Milestones will appear here when created via chat"
          }
        />
      )}
    </div>
  );
}
