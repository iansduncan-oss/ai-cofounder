import { useState, useMemo } from "react";
import { Link } from "react-router";
import { ArrowLeft, Calendar, Sparkles, RefreshCw } from "lucide-react";
import { useProductivityHistory, useProductivityWeekly } from "@/api/queries";
import type { PlannedItem, ProductivityMood } from "@ai-cofounder/api-client";

const MOOD_EMOJI: Record<ProductivityMood, string> = {
  great: "GREAT",
  good: "GOOD",
  okay: "OKAY",
  rough: "ROUGH",
  terrible: "TERRIBLE",
};

const MOOD_COLOR: Record<ProductivityMood, string> = {
  great: "text-emerald-500",
  good: "text-green-500",
  okay: "text-amber-500",
  rough: "text-orange-500",
  terrible: "text-red-500",
};

export function ProductivityHistoryPage() {
  const [limit, setLimit] = useState(30);
  const [showWeekly, setShowWeekly] = useState(false);
  const { data, isLoading } = useProductivityHistory({ limit });
  const {
    data: weekly,
    isLoading: loadingWeekly,
    refetch: refetchWeekly,
    isFetching: fetchingWeekly,
  } = useProductivityWeekly(showWeekly);

  const rows = useMemo(() => data?.data ?? [], [data]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/dashboard/productivity"
            className="rounded-md p-1.5 hover:bg-accent text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Calendar className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Productivity History</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowWeekly((s) => !s)}
            className="flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            <Sparkles className="h-4 w-4" />
            {showWeekly ? "Hide" : "Show"} Weekly Reflection
          </button>
        </div>
      </div>

      {/* Weekly Reflection Panel */}
      {showWeekly && (
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-500" />
              Weekly Reflection (AI-generated)
            </h2>
            <button
              onClick={() => refetchWeekly()}
              disabled={fetchingWeekly}
              className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-50"
              title="Regenerate"
            >
              <RefreshCw className={`h-4 w-4 ${fetchingWeekly ? "animate-spin" : ""}`} />
            </button>
          </div>
          {loadingWeekly || fetchingWeekly ? (
            <p className="text-sm text-muted-foreground">Generating reflection...</p>
          ) : weekly ? (
            <>
              <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-sm">
                {weekly.summary}
              </div>
              <div className="mt-3 pt-3 border-t grid grid-cols-4 gap-2 text-xs">
                <div>
                  <p className="text-muted-foreground">Days tracked</p>
                  <p className="text-lg font-bold">{weekly.stats.totalDays}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Avg completion</p>
                  <p className="text-lg font-bold">{weekly.stats.avgCompletion}%</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Avg energy</p>
                  <p className="text-lg font-bold">{weekly.stats.avgEnergy}/5</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Streak</p>
                  <p className="text-lg font-bold">{weekly.stats.currentStreak}</p>
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No data available.</p>
          )}
        </div>
      )}

      {/* Limit selector */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Show last:</span>
        {[7, 14, 30, 60, 90].map((n) => (
          <button
            key={n}
            onClick={() => setLimit(n)}
            className={`rounded-md px-3 py-1 font-medium transition-colors ${
              limit === n
                ? "bg-primary text-primary-foreground"
                : "border text-muted-foreground hover:bg-accent"
            }`}
          >
            {n}
          </button>
        ))}
      </div>

      {/* Log list */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No productivity logs yet. Start tracking from the{" "}
            <Link to="/dashboard/productivity" className="text-primary underline">
              productivity dashboard
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((log) => {
            const items: PlannedItem[] = (log.plannedItems as PlannedItem[] | null) ?? [];
            const completed = items.filter((i) => i.completed).length;
            const mood = log.mood as ProductivityMood | null;
            return (
              <div key={log.id} className="rounded-lg border bg-card p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="text-sm font-semibold">
                      {new Date(log.date).toLocaleDateString("en-US", {
                        weekday: "long",
                        month: "short",
                        day: "numeric",
                      })}
                    </h3>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      {log.completionScore != null && (
                        <span>
                          {completed}/{items.length} tasks ({log.completionScore}%)
                        </span>
                      )}
                      {mood && <span className={MOOD_COLOR[mood]}>{MOOD_EMOJI[mood]}</span>}
                      {log.energyLevel != null && <span>Energy: {log.energyLevel}/5</span>}
                      {log.streakDays > 0 && <span>Streak: {log.streakDays}</span>}
                    </div>
                  </div>
                </div>

                {items.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {items.map((item, idx) => (
                      <div
                        key={idx}
                        className={`text-xs flex items-center gap-2 ${
                          item.completed ? "text-muted-foreground line-through" : ""
                        }`}
                      >
                        <span className="inline-block w-3">{item.completed ? "[x]" : "[ ]"}</span>
                        <span>{item.text}</span>
                      </div>
                    ))}
                  </div>
                )}

                {(log.highlights || log.blockers || log.reflectionNotes) && (
                  <div className="mt-3 pt-3 border-t space-y-2 text-xs">
                    {log.highlights && (
                      <div>
                        <span className="font-semibold text-emerald-600">Highlights: </span>
                        <span className="text-muted-foreground">{log.highlights}</span>
                      </div>
                    )}
                    {log.blockers && (
                      <div>
                        <span className="font-semibold text-orange-600">Blockers: </span>
                        <span className="text-muted-foreground">{log.blockers}</span>
                      </div>
                    )}
                    {log.reflectionNotes && (
                      <div>
                        <span className="font-semibold">Notes: </span>
                        <span className="text-muted-foreground">{log.reflectionNotes}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
