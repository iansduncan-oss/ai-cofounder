import { useState } from "react";
import { usePatterns, usePatternAnalytics } from "@/api/queries";
import { useTogglePattern, useDeletePattern } from "@/api/mutations";
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
import { CreatePatternDialog } from "@/components/patterns/create-pattern-dialog";
import { EditPatternDialog } from "@/components/patterns/edit-pattern-dialog";
import { usePageTitle } from "@/hooks/use-page-title";
import { AlertTriangle, Trash2, ToggleLeft, ToggleRight, Plus, Pencil, TrendingUp, TrendingDown } from "lucide-react";
import type { UserPattern } from "@ai-cofounder/api-client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { ActivityHeatmap } from "@/components/patterns/activity-heatmap";

type PatternType = "all" | "time_preference" | "sequence" | "recurring_action";

const PIE_COLORS = ["#6366f1", "#8b5cf6", "#a78bfa", "#c4b5fd"];

function AcceptanceRateIndicator({ hitCount, acceptCount }: { hitCount: number; acceptCount: number }) {
  if (hitCount < 3) return null;
  const rate = (acceptCount / hitCount) * 100;
  if (rate >= 50) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-emerald-500">
        <TrendingUp className="h-3 w-3" />
        {rate.toFixed(0)}%
      </span>
    );
  }
  if (rate < 20) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-red-500">
        <TrendingDown className="h-3 w-3" />
        {rate.toFixed(0)}%
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">{rate.toFixed(0)}%</span>;
}

function AnalyticsSection() {
  const { data, isLoading } = usePatternAnalytics();

  if (isLoading || !data) return null;
  if (data.totalPatterns === 0 && (!data.heatmap || data.heatmap.length === 0)) return null;

  const barData = (data.perPattern ?? [])
    .filter((p) => p.hit_count > 0)
    .slice(0, 8)
    .map((p) => ({
      name: p.description.length > 25 ? p.description.slice(0, 22) + "..." : p.description,
      hitCount: p.hit_count,
      acceptRate: Number(p.accept_rate),
    }));

  const pieData = (data.typeDistribution ?? []).map((t) => ({
    name: t.pattern_type.replace(/_/g, " "),
    value: t.count,
  }));

  return (
    <div className="mb-6 space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {barData.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Acceptance Rate by Pattern</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={barData} layout="vertical" margin={{ left: 0, right: 12 }}>
                  <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} fontSize={12} />
                  <YAxis type="category" dataKey="name" width={120} fontSize={11} />
                  <Tooltip formatter={(v) => `${v}%`} />
                  <Bar dataKey="acceptRate" fill="#6366f1" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {pieData.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Type Distribution</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-center">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={(e) => e.name}>
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>

      {data.heatmap && data.heatmap.length > 0 && (
        <ActivityHeatmap data={data.heatmap} />
      )}
    </div>
  );
}

export function PatternsPage() {
  usePageTitle("Patterns");
  const [filterType, setFilterType] = useState<PatternType>("all");
  const [includeInactive, setIncludeInactive] = useState(false);

  const { data, isLoading, error } = usePatterns(undefined, includeInactive);
  const toggleMutation = useTogglePattern();
  const deleteMutation = useDeletePattern();

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserPattern | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<UserPattern | null>(null);

  const patterns = (data?.data ?? []).filter(
    (p) => filterType === "all" || p.patternType === filterType,
  );

  function confirmDelete(p: UserPattern) {
    setDeleteTarget(p);
    setDeleteDialogOpen(true);
  }

  function handleDelete() {
    if (!deleteTarget) return;
    deleteMutation.mutate(deleteTarget.id, {
      onSuccess: () => setDeleteDialogOpen(false),
    });
  }

  function typeBadgeVariant(type: string) {
    switch (type) {
      case "time_preference":
        return "default" as const;
      case "sequence":
        return "secondary" as const;
      case "recurring_action":
        return "outline" as const;
      default:
        return "outline" as const;
    }
  }

  return (
    <div>
      <PageHeader
        title="Patterns"
        description="Learned behavioral patterns that power anticipatory suggestions"
        actions={
          <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            Create Pattern
          </Button>
        }
      />

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as PatternType)}
          className="rounded-md border bg-card px-3 py-1.5 text-sm"
        >
          <option value="all">All types</option>
          <option value="time_preference">Time preference</option>
          <option value="sequence">Sequence</option>
          <option value="recurring_action">Recurring action</option>
        </select>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
            className="h-4 w-4 rounded border-input"
          />
          Include inactive
        </label>
      </div>

      <AnalyticsSection />

      <div className="space-y-4">
        {isLoading ? (
          <ListSkeleton rows={3} />
        ) : error ? (
          <Card>
            <CardContent className="py-6">
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4" />
                <span>Failed to load patterns: {error.message}</span>
              </div>
            </CardContent>
          </Card>
        ) : patterns.length === 0 ? (
          <EmptyState
            title="No patterns yet"
            description="Patterns are learned automatically as you interact with the system, or create one manually."
          />
        ) : (
          patterns.map((p) => (
            <Card key={p.id} className={!p.isActive ? "opacity-60" : undefined}>
              <CardHeader className="flex flex-col gap-2 pb-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">{p.description}</CardTitle>
                  <Badge variant={typeBadgeVariant(p.patternType)}>
                    {p.patternType.replace(/_/g, " ")}
                  </Badge>
                  {!p.isActive && <Badge variant="secondary">Inactive</Badge>}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditTarget(p)}
                    title="Edit"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      toggleMutation.mutate({
                        id: p.id,
                        isActive: !p.isActive,
                      })
                    }
                    disabled={toggleMutation.isPending}
                    title={p.isActive ? "Deactivate" : "Activate"}
                  >
                    {p.isActive ? (
                      <ToggleRight className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <ToggleLeft className="h-4 w-4" />
                    )}
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
                    <span className="text-muted-foreground">Suggestion: </span>
                    <span>{p.suggestedAction}</span>
                  </div>
                  <div className="flex flex-wrap gap-4 text-muted-foreground">
                    <span>
                      Confidence:{" "}
                      <span className="font-medium text-foreground">
                        {p.confidence}%
                      </span>
                    </span>
                    <span>
                      Hit / Accept:{" "}
                      <span className="font-medium text-foreground">
                        {p.hitCount} / {p.acceptCount}
                      </span>
                    </span>
                    <AcceptanceRateIndicator hitCount={p.hitCount} acceptCount={p.acceptCount} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Create Dialog */}
      <CreatePatternDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
      />

      {/* Edit Dialog */}
      {editTarget && (
        <EditPatternDialog
          open={!!editTarget}
          onClose={() => setEditTarget(null)}
          pattern={editTarget}
        />
      )}

      {/* Delete Confirmation */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
      >
        <DialogHeader>
          <DialogTitle>Delete Pattern</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this pattern? This cannot be undone.
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
