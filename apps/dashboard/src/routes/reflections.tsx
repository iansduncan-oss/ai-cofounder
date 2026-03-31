import { useState } from "react";
import { useReflections, useReflectionStats } from "@/api/queries";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ListSkeleton } from "@/components/common/loading-skeleton";
import { usePageTitle } from "@/hooks/use-page-title";
import { formatDate } from "@/lib/utils";
import { BookOpen, ChevronDown, ChevronRight } from "lucide-react";
import type { ReflectionType } from "@ai-cofounder/api-client";

const TYPE_TABS: { label: string; value: ReflectionType | undefined }[] = [
  { label: "All", value: undefined },
  { label: "Goal Completion", value: "goal_completion" },
  { label: "Failure Analysis", value: "failure_analysis" },
  { label: "Patterns", value: "pattern_extraction" },
  { label: "Weekly", value: "weekly_summary" },
];

const TYPE_COLORS: Record<string, string> = {
  goal_completion: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  failure_analysis: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  pattern_extraction: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  weekly_summary: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
};

export function ReflectionsPage() {
  usePageTitle("Reflections");
  const [activeType, setActiveType] = useState<ReflectionType | undefined>();
  const { data, isLoading } = useReflections(activeType);
  const { data: statsData } = useReflectionStats();
  const reflections = data?.data ?? [];
  const stats = statsData?.stats;
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div>
      <PageHeader title="Reflections" description="Post-goal learning and self-improvement analysis" />

      {stats && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-lg font-semibold">{stats.totalReflections}</p>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">Lessons</p>
            <p className="text-lg font-semibold">{stats.totalLessons}</p>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">Avg/Reflection</p>
            <p className="text-lg font-semibold">{stats.avgLessonsPerReflection.toFixed(1)}</p>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">Types</p>
            <p className="text-lg font-semibold">{Object.keys(stats.byType).length}</p>
          </div>
        </div>
      )}

      <div className="mb-4 flex gap-1 rounded-lg bg-muted p-1">
        {TYPE_TABS.map((tab) => (
          <button
            key={tab.label}
            onClick={() => setActiveType(tab.value)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              activeType === tab.value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <ListSkeleton rows={5} />
      ) : reflections.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <BookOpen className="mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">No reflections yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Reflections are generated after goals complete.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {reflections.map((r) => {
            const expanded = expandedIds.has(r.id);
            const lessonCount = r.lessons?.length ?? 0;
            return (
              <Card key={r.id}>
                <CardContent className="pt-4">
                  <button
                    onClick={() => toggle(r.id)}
                    className="flex w-full items-center gap-2 text-left"
                  >
                    {expanded ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="flex-1 text-sm font-medium line-clamp-1">
                      {r.content.slice(0, 120)}
                    </span>
                    <Badge className={TYPE_COLORS[r.reflectionType] ?? ""}>
                      {r.reflectionType.replace("_", " ")}
                    </Badge>
                    {lessonCount > 0 && (
                      <Badge variant="outline" className="text-xs">
                        {lessonCount} lesson{lessonCount !== 1 ? "s" : ""}
                      </Badge>
                    )}
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDate(r.createdAt)}
                    </span>
                  </button>
                  {expanded && (
                    <div className="mt-3 space-y-3">
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
                        {r.content}
                      </pre>
                      {r.lessons && r.lessons.length > 0 && (
                        <div>
                          <p className="mb-1 text-xs font-medium text-muted-foreground">Lessons</p>
                          <div className="space-y-1">
                            {r.lessons.map((l, i) => (
                              <div key={i} className="flex items-start gap-2 rounded-md bg-muted/50 p-2 text-xs">
                                <span className="flex-1">{l.lesson}</span>
                                <Badge variant="outline">{l.category}</Badge>
                                <span className="text-muted-foreground">{(l.confidence * 100).toFixed(0)}%</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
