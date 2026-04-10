import { useState, useMemo } from "react";
import { Link } from "react-router";
import {
  Flame,
  Plus,
  Check,
  Trash2,
  TrendingUp,
  Smile,
  Frown,
  Meh,
  Zap,
  Sun,
  Moon,
  CloudRain,
  SmilePlus,
  History,
  Sparkles,
  RefreshCw,
  Wand2,
  Search,
  AlertTriangle,
  X as XIcon,
  CheckCheck,
  ArrowDownToLine,
} from "lucide-react";
import { useProductivityToday, useProductivityStats, useProductivityWeekly, useCodebaseInsights } from "@/api/queries";
import { useUpsertProductivity, useAutoPlanProductivity, useScanCodebase, useUpdateInsightStatus, useSyncProductivityPlan } from "@/api/mutations";
import type { PlannedItem, ProductivityMood, CodebaseInsight } from "@ai-cofounder/api-client";

const MOOD_OPTIONS: { value: ProductivityMood; icon: typeof Smile; label: string; color: string }[] = [
  { value: "great", icon: SmilePlus, label: "Great", color: "text-emerald-500" },
  { value: "good", icon: Smile, label: "Good", color: "text-green-500" },
  { value: "okay", icon: Meh, label: "Okay", color: "text-amber-500" },
  { value: "rough", icon: Frown, label: "Rough", color: "text-orange-500" },
  { value: "terrible", icon: CloudRain, label: "Terrible", color: "text-red-500" },
];

const ENERGY_LEVELS = [1, 2, 3, 4, 5];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function ProductivityPage() {
  const today = useMemo(todayStr, []);
  const { data: todayLog, isLoading: loadingToday } = useProductivityToday();
  const { data: stats, isLoading: loadingStats } = useProductivityStats(30);
  const upsert = useUpsertProductivity();
  const autoPlan = useAutoPlanProductivity();
  const scanCodebase = useScanCodebase();
  const syncPlan = useSyncProductivityPlan();
  const updateInsight = useUpdateInsightStatus();
  const { data: insightsData } = useCodebaseInsights("open");

  const [showWeekly, setShowWeekly] = useState(false);
  const {
    data: weekly,
    isFetching: fetchingWeekly,
    refetch: refetchWeekly,
  } = useProductivityWeekly(showWeekly);

  const [newItemText, setNewItemText] = useState("");
  const [reflectionDraft, setReflectionDraft] = useState("");
  const [highlightsDraft, setHighlightsDraft] = useState("");
  const [blockersDraft, setBlockersDraft] = useState("");

  const plannedItems: PlannedItem[] = (todayLog?.plannedItems as PlannedItem[]) ?? [];
  const streakDays = todayLog?.streakDays ?? 0;
  const mood = todayLog?.mood as ProductivityMood | null | undefined;
  const energyLevel = todayLog?.energyLevel as number | null | undefined;
  const completionScore = todayLog?.completionScore as number | null | undefined;

  function addItem() {
    if (!newItemText.trim()) return;
    const updated = [...plannedItems, { text: newItemText.trim(), completed: false }];
    upsert.mutate({ date: today, plannedItems: updated });
    setNewItemText("");
  }

  function toggleItem(idx: number) {
    const updated = plannedItems.map((item, i) =>
      i === idx ? { ...item, completed: !item.completed } : item,
    );
    upsert.mutate({ date: today, plannedItems: updated });
  }

  function removeItem(idx: number) {
    const updated = plannedItems.filter((_, i) => i !== idx);
    upsert.mutate({ date: today, plannedItems: updated });
  }

  function setMood(m: ProductivityMood) {
    upsert.mutate({ date: today, plannedItems, mood: m });
  }

  function setEnergy(level: number) {
    upsert.mutate({ date: today, plannedItems, energyLevel: level });
  }

  function saveReflection() {
    upsert.mutate({
      date: today,
      plannedItems,
      reflectionNotes: reflectionDraft || undefined,
      highlights: highlightsDraft || undefined,
      blockers: blockersDraft || undefined,
    });
  }

  const completedCount = plannedItems.filter((i) => i.completed).length;
  const totalCount = plannedItems.length;

  if (loadingToday || loadingStats) {
    return <div className="p-8 text-center text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TrendingUp className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">Daily Productivity</h1>
            <p className="text-sm text-muted-foreground">{today}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {/* Streak */}
          <div className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1.5">
            <Flame className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-bold text-amber-600">{streakDays}</span>
            <span className="text-xs text-muted-foreground">day streak</span>
          </div>
          <Link
            to="/dashboard/productivity/history"
            className="flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            <History className="h-4 w-4" />
            History
          </Link>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">Avg Completion</p>
            <p className="text-2xl font-bold">{stats.avgCompletion}%</p>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">Avg Energy</p>
            <p className="text-2xl font-bold">{stats.avgEnergy}/5</p>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">Days Tracked</p>
            <p className="text-2xl font-bold">{stats.totalDays}</p>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">Current Streak</p>
            <p className="text-2xl font-bold">{stats.currentStreak}</p>
          </div>
        </div>
      )}

      {/* Codebase Insights (auto-scanned every 4h) */}
      {insightsData && insightsData.data.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Codebase Insights</h2>
              <span className="text-xs text-muted-foreground">— auto-discovered from your recent work</span>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                {insightsData.data.length}
              </span>
            </div>
            <button
              onClick={() => scanCodebase.mutate({ synthesize: true })}
              disabled={scanCodebase.isPending}
              className="flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
              title="Run a fresh scan"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${scanCodebase.isPending ? "animate-spin" : ""}`} />
              Rescan
            </button>
          </div>
          <div className="space-y-2">
            {insightsData.data.slice(0, 6).map((insight: CodebaseInsight) => (
              <div
                key={insight.id}
                className="flex items-start justify-between gap-3 rounded-md border bg-background/50 p-3 text-sm"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                        insight.severity === "critical"
                          ? "bg-red-500/20 text-red-600"
                          : insight.severity === "high"
                            ? "bg-orange-500/20 text-orange-600"
                            : insight.severity === "medium"
                              ? "bg-amber-500/20 text-amber-600"
                              : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {insight.category}
                    </span>
                    {insight.severity === "critical" || insight.severity === "high" ? (
                      <AlertTriangle className="h-3 w-3 text-orange-500" />
                    ) : null}
                    <span className="text-xs text-muted-foreground">via {insight.source}</span>
                  </div>
                  <p className="text-sm font-medium truncate">{insight.title}</p>
                  {insight.suggestedAction && (
                    <p className="mt-0.5 text-xs text-muted-foreground truncate">
                      {insight.suggestedAction}
                    </p>
                  )}
                  {insight.reference && (
                    <p className="mt-0.5 text-xs text-muted-foreground font-mono truncate">
                      {insight.reference}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => updateInsight.mutate({ id: insight.id, status: "resolved" })}
                    className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-emerald-600"
                    title="Mark resolved"
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => updateInsight.mutate({ id: insight.id, status: "dismissed" })}
                    className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                    title="Dismiss"
                  >
                    <XIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          {insightsData.data.length > 6 && (
            <p className="mt-2 text-xs text-muted-foreground">
              _Showing 6 of {insightsData.data.length}. Run `/autoplan` to pull these into today's plan._
            </p>
          )}
        </div>
      )}

      {/* If no insights yet, show a scan prompt */}
      {insightsData && insightsData.data.length === 0 && (
        <div className="rounded-lg border border-dashed bg-card/50 p-4 text-center">
          <Search className="mx-auto h-5 w-5 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground mb-2">
            No codebase insights yet. Let Jarvis scan your recent work for things to fix, improve, or add.
          </p>
          <button
            onClick={() => scanCodebase.mutate({ synthesize: true })}
            disabled={scanCodebase.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Search className="h-3.5 w-3.5" />
            {scanCodebase.isPending ? "Scanning..." : "Run first scan"}
          </button>
        </div>
      )}

      {/* Weekly AI Reflection */}
      <div className="rounded-lg border bg-gradient-to-br from-amber-500/5 to-primary/5 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-500" />
            <h2 className="text-sm font-semibold">Weekly Reflection</h2>
            <span className="text-xs text-muted-foreground">— AI-generated from last 7 days</span>
          </div>
          <div className="flex items-center gap-1">
            {showWeekly && (
              <button
                onClick={() => refetchWeekly()}
                disabled={fetchingWeekly}
                className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-50"
                title="Regenerate"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${fetchingWeekly ? "animate-spin" : ""}`} />
              </button>
            )}
            <button
              onClick={() => setShowWeekly((s) => !s)}
              className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
            >
              {showWeekly ? "Hide" : "Generate"}
            </button>
          </div>
        </div>
        {showWeekly && (
          <div className="mt-3">
            {fetchingWeekly ? (
              <p className="text-sm text-muted-foreground">Reflecting on your week...</p>
            ) : weekly ? (
              <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-sm">
                {weekly.summary}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No data available.</p>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: Plan + Items */}
        <div className="space-y-4">
          {/* Today's Plan */}
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">Today's Plan</h2>
                {totalCount > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {completedCount}/{totalCount} done
                    {completionScore != null && ` (${completionScore}%)`}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {totalCount > 0 && (
                  <button
                    onClick={() => syncPlan.mutate({ lookbackMinutes: 240, topUp: true })}
                    disabled={syncPlan.isPending}
                    className="flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
                    title="Auto-mark completed items and add new urgent work"
                  >
                    <ArrowDownToLine className={`h-3.5 w-3.5 ${syncPlan.isPending ? "animate-pulse" : ""}`} />
                    Sync
                  </button>
                )}
                <button
                  onClick={() => autoPlan.mutate({ merge: totalCount > 0 })}
                  disabled={autoPlan.isPending}
                  className="flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
                  title={totalCount > 0 ? "Add AI-suggested items to existing plan" : "Let Jarvis plan my day"}
                >
                  <Wand2 className={`h-3.5 w-3.5 ${autoPlan.isPending ? "animate-pulse" : ""}`} />
                  {totalCount > 0 ? "Add suggestions" : "Auto-plan my day"}
                </button>
              </div>
            </div>

            {/* Progress bar */}
            {totalCount > 0 && (
              <div className="mb-3 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%` }}
                />
              </div>
            )}

            {/* Items */}
            <div className="space-y-2">
              {plannedItems.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 rounded-md border bg-background px-3 py-2"
                >
                  <button
                    onClick={() => toggleItem(idx)}
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                      item.completed
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-muted-foreground/30 hover:border-primary"
                    }`}
                  >
                    {item.completed && <Check className="h-3 w-3" />}
                  </button>
                  <span
                    className={`flex-1 text-sm ${
                      item.completed ? "text-muted-foreground line-through" : ""
                    }`}
                  >
                    {item.text}
                  </span>
                  {item.completedBy && (
                    <span
                      className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-600"
                      title={`Auto-marked via ${item.completedBy}`}
                    >
                      Auto
                    </span>
                  )}
                  <button
                    onClick={() => removeItem(idx)}
                    className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Add item */}
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                placeholder="Add a task for today..."
                value={newItemText}
                onChange={(e) => setNewItemText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addItem()}
                className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
              />
              <button
                onClick={addItem}
                disabled={!newItemText.trim()}
                className="flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" /> Add
              </button>
            </div>
          </div>

          {/* Mood & Energy */}
          <div className="rounded-lg border bg-card p-4 space-y-4">
            <div>
              <h2 className="text-sm font-semibold mb-2">How are you feeling?</h2>
              <div className="flex gap-2">
                {MOOD_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const isActive = mood === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setMood(opt.value)}
                      className={`flex flex-col items-center gap-1 rounded-lg border px-3 py-2 text-xs transition-colors ${
                        isActive
                          ? "border-primary bg-primary/10 " + opt.color
                          : "border-transparent hover:bg-accent text-muted-foreground"
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <h2 className="text-sm font-semibold mb-2">Energy Level</h2>
              <div className="flex gap-2">
                {ENERGY_LEVELS.map((level) => {
                  const isActive = energyLevel === level;
                  return (
                    <button
                      key={level}
                      onClick={() => setEnergy(level)}
                      className={`flex items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                        isActive
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-transparent hover:bg-accent text-muted-foreground"
                      }`}
                    >
                      <Zap className={`h-4 w-4 mr-1 ${isActive ? "text-amber-500" : ""}`} />
                      {level}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Reflection + Trend */}
        <div className="space-y-4">
          {/* End-of-day Reflection */}
          <div className="rounded-lg border bg-card p-4">
            <h2 className="text-sm font-semibold mb-3">Reflection</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">What went well?</label>
                <textarea
                  placeholder="Highlights of the day..."
                  value={highlightsDraft || (todayLog?.highlights as string) || ""}
                  onChange={(e) => setHighlightsDraft(e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">What was challenging?</label>
                <textarea
                  placeholder="Blockers or difficulties..."
                  value={blockersDraft || (todayLog?.blockers as string) || ""}
                  onChange={(e) => setBlockersDraft(e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Notes</label>
                <textarea
                  placeholder="Any other thoughts..."
                  value={reflectionDraft || (todayLog?.reflectionNotes as string) || ""}
                  onChange={(e) => setReflectionDraft(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
              <button
                onClick={saveReflection}
                disabled={upsert.isPending}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Save Reflection
              </button>
            </div>
          </div>

          {/* Trend (last 7 days from stats) */}
          {stats && stats.history.length > 0 && (
            <div className="rounded-lg border bg-card p-4">
              <h2 className="text-sm font-semibold mb-3">Completion Trend (30 days)</h2>
              <div className="flex items-end gap-1 h-24">
                {stats.history.slice(-30).map((day, idx) => {
                  const score = day.completionScore ?? 0;
                  return (
                    <div
                      key={idx}
                      className="flex-1 flex flex-col items-center gap-0.5"
                      title={`${day.date}: ${score}%`}
                    >
                      <div
                        className={`w-full rounded-t transition-all ${
                          score >= 80
                            ? "bg-emerald-500"
                            : score >= 50
                              ? "bg-amber-500"
                              : score > 0
                                ? "bg-red-400"
                                : "bg-muted"
                        }`}
                        style={{ height: `${Math.max(score, 4)}%` }}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                <span>{stats.history[0]?.date?.slice(5)}</span>
                <span>{stats.history[stats.history.length - 1]?.date?.slice(5)}</span>
              </div>
            </div>
          )}

          {/* Mood Distribution */}
          {stats && Object.keys(stats.moodCounts).length > 0 && (
            <div className="rounded-lg border bg-card p-4">
              <h2 className="text-sm font-semibold mb-3">Mood Distribution</h2>
              <div className="space-y-2">
                {MOOD_OPTIONS.map((opt) => {
                  const count = stats.moodCounts[opt.value] ?? 0;
                  const pct = stats.totalDays > 0 ? Math.round((count / stats.totalDays) * 100) : 0;
                  if (count === 0) return null;
                  const Icon = opt.icon;
                  return (
                    <div key={opt.value} className="flex items-center gap-2">
                      <Icon className={`h-4 w-4 ${opt.color}`} />
                      <span className="text-xs w-16">{opt.label}</span>
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            opt.value === "great"
                              ? "bg-emerald-500"
                              : opt.value === "good"
                                ? "bg-green-500"
                                : opt.value === "okay"
                                  ? "bg-amber-500"
                                  : opt.value === "rough"
                                    ? "bg-orange-500"
                                    : "bg-red-500"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground w-8 text-right">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
