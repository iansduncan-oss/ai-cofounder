import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useGoals } from "@/api/queries";
import { PageHeader } from "@/components/layout/page-header";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { GoalStatusBadge } from "@/components/common/status-badge";
import { ListSkeleton } from "@/components/common/loading-skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { RelativeTime } from "@/components/common/relative-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/hooks/use-page-title";
import { Target, Search, AlertTriangle, MessageSquare, Plus } from "lucide-react";
import { CreateGoalDialog } from "@/components/goals/create-goal-dialog";
import type { GoalStatus, GoalPriority } from "@ai-cofounder/api-client";

export function GoalsPage() {
  usePageTitle("Goals");
  const [searchParams, setSearchParams] = useSearchParams();
  const [showCreate, setShowCreate] = useState(false);

  const conversationId = searchParams.get("conversationId") || "default";
  const statusFilter = (searchParams.get("status") || "all") as GoalStatus | "all";
  const priorityFilter = (searchParams.get("priority") || "all") as GoalPriority | "all";
  const search = searchParams.get("search") || "";

  const setFilter = (key: string, value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === "" || value === "all" || (key === "conversationId" && value === "default")) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      return next;
    });
  };

  const { data: goalsData, isLoading, error } = useGoals(conversationId);
  const goals = goalsData?.data;

  const filtered = goals?.filter((g) => {
    if (statusFilter !== "all" && g.status !== statusFilter) return false;
    if (priorityFilter !== "all" && g.priority !== priorityFilter) return false;
    if (search && !g.title.toLowerCase().includes(search.toLowerCase()))
      return false;
    return true;
  });

  const priorityColors: Record<GoalPriority, "default" | "secondary" | "warning" | "destructive"> = {
    low: "secondary",
    medium: "default",
    high: "warning",
    critical: "destructive",
  };

  return (
    <div>
      <PageHeader
        title="Goals"
        description="Track and manage agent goals"
        actions={
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New Goal
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search goals..."
            value={search}
            onChange={(e) => setFilter("search", e.target.value)}
            className="w-60 pl-8"
          />
        </div>
        <Input
          placeholder="Conversation ID"
          value={conversationId}
          onChange={(e) => setFilter("conversationId", e.target.value || "default")}
          className="w-48"
        />
        <Select
          value={statusFilter}
          onChange={(e) => setFilter("status", e.target.value)}
          className="w-36"
        >
          <option value="all">All statuses</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </Select>
        <Select
          value={priorityFilter}
          onChange={(e) => setFilter("priority", e.target.value)}
          className="w-36"
        >
          <option value="all">All priorities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </Select>
      </div>

      {error ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <AlertTriangle className="mb-3 h-8 w-8 text-destructive" />
          <p className="text-sm font-medium">Failed to load goals</p>
          <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>
        </div>
      ) : isLoading ? (
        <ListSkeleton rows={5} />
      ) : filtered && filtered.length > 0 ? (
        <div className="space-y-2">
          {filtered.map((goal) => (
            <Link
              key={goal.id}
              to={`/dashboard/goals/${goal.id}`}
              className="block rounded-lg border bg-card p-4 transition-all hover:bg-accent hover:shadow-md hover:-translate-y-0.5"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="text-sm font-medium">{goal.title}</h3>
                  {goal.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {goal.description}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    <RelativeTime date={goal.createdAt} />
                    {goal.createdBy && ` · by ${goal.createdBy}`}
                  </p>
                </div>
                <div className="ml-4 flex items-center gap-2">
                  <Badge variant={priorityColors[goal.priority]}>
                    {goal.priority}
                  </Badge>
                  <GoalStatusBadge status={goal.status} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Target className="h-10 w-10" />}
          title="No goals found"
          description={
            search || statusFilter !== "all" || priorityFilter !== "all"
              ? "Try adjusting your filters"
              : "Goals will appear here when created via chat"
          }
          action={
            !search && statusFilter === "all" && priorityFilter === "all" ? (
              <Link to="/dashboard/chat">
                <Button variant="outline" size="sm">
                  <MessageSquare className="mr-1.5 h-3 w-3" />
                  Create via Chat
                </Button>
              </Link>
            ) : undefined
          }
        />
      )}

      <CreateGoalDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        defaultConversationId={conversationId}
      />
    </div>
  );
}
