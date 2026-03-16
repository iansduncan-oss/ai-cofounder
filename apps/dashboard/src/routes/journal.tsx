import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  GitCommit, GitPullRequest, CheckCircle2, XCircle, FileText,
  Zap, Clock, Target, Bot, Rocket, Search, Workflow,
} from "lucide-react";
import { apiClient } from "@/api/client";
import { queryKeys } from "@/lib/query-keys";
import type { JournalEntry, JournalEntryType } from "@ai-cofounder/api-client";

const typeConfig: Record<string, { icon: typeof GitCommit; color: string; label: string }> = {
  goal_started: { icon: Target, color: "text-blue-500", label: "Goal Started" },
  goal_completed: { icon: CheckCircle2, color: "text-green-500", label: "Goal Completed" },
  goal_failed: { icon: XCircle, color: "text-red-500", label: "Goal Failed" },
  task_completed: { icon: CheckCircle2, color: "text-emerald-400", label: "Task Completed" },
  task_failed: { icon: XCircle, color: "text-orange-500", label: "Task Failed" },
  git_commit: { icon: GitCommit, color: "text-purple-500", label: "Commit" },
  pr_created: { icon: GitPullRequest, color: "text-indigo-500", label: "PR Created" },
  reflection: { icon: FileText, color: "text-yellow-500", label: "Reflection" },
  work_session: { icon: Clock, color: "text-cyan-500", label: "Work Session" },
  subagent_run: { icon: Bot, color: "text-pink-500", label: "Subagent Run" },
  deployment: { icon: Rocket, color: "text-teal-500", label: "Deployment" },
  content_pipeline: { icon: Workflow, color: "text-orange-400", label: "Content Pipeline" },
};

function RelativeTime({ date }: { date: string }) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return <span>just now</span>;
  if (mins < 60) return <span>{mins}m ago</span>;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return <span>{hrs}h ago</span>;
  const days = Math.floor(hrs / 24);
  return <span>{days}d ago</span>;
}

function EntryCard({ entry }: { entry: JournalEntry }) {
  const config = typeConfig[entry.entryType] ?? typeConfig.work_session;
  const Icon = config.icon;
  const details = entry.details as Record<string, unknown> | null;

  return (
    <div className="relative pl-8 pb-6 group">
      <div className="absolute left-0 top-1 w-6 h-6 rounded-full bg-card border-2 border-border flex items-center justify-center">
        <Icon className={`w-3 h-3 ${config.color}`} />
      </div>
      <div className="absolute left-[11px] top-7 bottom-0 w-px bg-border group-last:hidden" />
      <div className="bg-card rounded-lg border border-border p-3">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full bg-muted ${config.color}`}>
            {config.label}
          </span>
          <span className="text-xs text-muted-foreground">
            <RelativeTime date={entry.occurredAt} />
          </span>
        </div>
        <p className="text-sm font-medium">{entry.title}</p>
        {entry.summary && (
          <p className="text-xs text-muted-foreground mt-1">{entry.summary}</p>
        )}
        <div className="flex gap-2 mt-2 flex-wrap items-center">
          {entry.goalId && (
            <Link
              to={`/dashboard/goals/${entry.goalId}`}
              className="text-xs text-blue-500 hover:underline"
            >
              View Goal
            </Link>
          )}
          {entry.taskId && (
            <Link
              to={`/dashboard/goals/${entry.goalId}?task=${entry.taskId}`}
              className="text-xs text-cyan-500 hover:underline"
            >
              View Task
            </Link>
          )}
          {details?.prUrl ? (
            <a
              href={String(details.prUrl)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-indigo-500 hover:underline"
            >
              View PR
            </a>
          ) : null}
          {details?.sha ? (
            <span className="text-xs font-mono text-muted-foreground">
              {String(details.sha).slice(0, 7)}
            </span>
          ) : null}
          {details?.agent ? (
            <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              {String(details.agent)}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const entryTypes: JournalEntryType[] = [
  "goal_started", "goal_completed", "goal_failed",
  "task_completed", "task_failed",
  "git_commit", "pr_created", "reflection", "work_session",
  "subagent_run", "deployment", "content_pipeline",
];

function toDateString(date: Date): string {
  return date.toISOString().split("T")[0];
}

export function JournalPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [groupBy, setGroupBy] = useState<"timeline" | "goal">("timeline");
  const [fromDate, setFromDate] = useState(() =>
    toDateString(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
  );
  const [toDate, setToDate] = useState(() => toDateString(new Date()));

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const params = {
    search: debouncedSearch || undefined,
    entryType: typeFilter || undefined,
    limit: 50,
  };
  const paramsKey = JSON.stringify(params);

  const { data: journal, isLoading } = useQuery({
    queryKey: queryKeys.journal.list(paramsKey),
    queryFn: () => apiClient.listJournalEntries(params),
  });

  // Client-side date range filtering
  const filteredEntries = useMemo(() => {
    if (!journal?.data) return [];
    return journal.data.filter((entry) => {
      const entryDate = entry.occurredAt.split("T")[0];
      if (fromDate && entryDate < fromDate) return false;
      if (toDate && entryDate > toDate) return false;
      return true;
    });
  }, [journal?.data, fromDate, toDate]);

  // Group entries by goal for "By Goal" view
  const groupedByGoal = useMemo(() => {
    if (groupBy !== "goal") return null;
    const groups = new Map<string, { goalTitle: string; entries: JournalEntry[] }>();
    const ungrouped: JournalEntry[] = [];
    for (const entry of filteredEntries) {
      if (entry.goalId) {
        const existing = groups.get(entry.goalId);
        if (existing) {
          existing.entries.push(entry);
        } else {
          // Extract goal title from the first goal-level entry, or use a fallback
          const goalTitle = entry.title.replace(/^(Goal started|Goal completed|Goal failed): /, "") || "Goal";
          groups.set(entry.goalId, { goalTitle, entries: [entry] });
        }
      } else {
        ungrouped.push(entry);
      }
    }
    return { groups: Array.from(groups.entries()), ungrouped };
  }, [filteredEntries, groupBy]);

  const { data: standup } = useQuery({
    queryKey: queryKeys.journal.standup(),
    queryFn: () => apiClient.getStandup(),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Work Journal</h1>

      {standup && (
        <div className="bg-card rounded-lg border border-border p-4">
          <h2 className="text-sm font-semibold mb-2">Today's Standup</h2>
          <p className="text-sm text-muted-foreground whitespace-pre-line">
            {standup.narrative}
          </p>
          {standup.data.totalEntries > 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              {standup.data.totalEntries} entries today
            </p>
          )}
        </div>
      )}

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search journal..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-2 text-sm bg-card border border-border rounded-lg"
        >
          <option value="">All types</option>
          {entryTypes.map((t) => (
            <option key={t} value={t}>
              {typeConfig[t]?.label ?? t}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          From
          <input
            type="date"
            aria-label="From"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="rounded border bg-card border-border px-3 py-2 text-sm"
          />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          To
          <input
            type="date"
            aria-label="To"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="rounded border bg-card border-border px-3 py-2 text-sm"
          />
        </label>
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => setGroupBy("timeline")}
            className={`px-3 py-2 text-xs ${groupBy === "timeline" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted"}`}
          >
            Timeline
          </button>
          <button
            onClick={() => setGroupBy("goal")}
            className={`px-3 py-2 text-xs ${groupBy === "goal" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted"}`}
          >
            By Goal
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : filteredEntries.length > 0 ? (
        groupBy === "goal" && groupedByGoal ? (
          <div className="space-y-6">
            {groupedByGoal.groups.map(([goalId, group]) => (
              <div key={goalId} className="bg-card/50 rounded-lg border border-border p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Target className="w-4 h-4 text-blue-500" />
                  <Link
                    to={`/dashboard/goals/${goalId}`}
                    className="text-sm font-semibold hover:underline"
                  >
                    {group.goalTitle}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {group.entries.length} {group.entries.length === 1 ? "entry" : "entries"}
                  </span>
                </div>
                <div className="relative">
                  {group.entries.map((entry) => (
                    <EntryCard key={entry.id} entry={entry} />
                  ))}
                </div>
              </div>
            ))}
            {groupedByGoal.ungrouped.length > 0 && (
              <div className="bg-card/50 rounded-lg border border-border p-4">
                <p className="text-sm font-semibold mb-3 text-muted-foreground">Other entries</p>
                <div className="relative">
                  {groupedByGoal.ungrouped.map((entry) => (
                    <EntryCard key={entry.id} entry={entry} />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="relative">
            {filteredEntries.map((entry) => (
              <EntryCard key={entry.id} entry={entry} />
            ))}
          </div>
        )
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          No journal entries found.
        </div>
      )}

      {journal && journal.total > 50 && (
        <p className="text-xs text-center text-muted-foreground">
          Showing 50 of {journal.total} entries
        </p>
      )}
    </div>
  );
}
