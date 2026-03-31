import { useState } from "react";
import { useNavigate } from "react-router";
import { useGlobalSearch } from "@/api/queries";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ListSkeleton } from "@/components/common/loading-skeleton";
import { usePageTitle } from "@/hooks/use-page-title";
import { formatDate } from "@/lib/utils";
import { Search, Target, ListChecks, MessageSquare, Brain } from "lucide-react";

type ResultTab = "all" | "goals" | "tasks" | "conversations" | "memories";

const TABS: { label: string; value: ResultTab; icon: React.ComponentType<{ className?: string }> }[] = [
  { label: "All", value: "all", icon: Search },
  { label: "Goals", value: "goals", icon: Target },
  { label: "Tasks", value: "tasks", icon: ListChecks },
  { label: "Conversations", value: "conversations", icon: MessageSquare },
  { label: "Memories", value: "memories", icon: Brain },
];

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  active: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  running: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  cancelled: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
};

export function SearchPage() {
  usePageTitle("Search");
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [activeTab, setActiveTab] = useState<ResultTab>("all");
  const { data, isLoading } = useGlobalSearch(activeQuery);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setActiveQuery(query);
  };

  const totalResults = data
    ? (data.goals?.length ?? 0) + (data.tasks?.length ?? 0) + (data.conversations?.length ?? 0) + (data.memories?.length ?? 0)
    : 0;

  const showGoals = activeTab === "all" || activeTab === "goals";
  const showTasks = activeTab === "all" || activeTab === "tasks";
  const showConversations = activeTab === "all" || activeTab === "conversations";
  const showMemories = activeTab === "all" || activeTab === "memories";

  return (
    <div>
      <PageHeader title="Search" description="Search across goals, tasks, conversations, and memories" />

      <form onSubmit={handleSubmit} className="mb-6">
        <div className="relative max-w-xl">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search everything..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-lg border bg-background py-2.5 pl-10 pr-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            autoFocus
          />
        </div>
      </form>

      {activeQuery && (
        <>
          {/* Filter Tabs */}
          <div className="mb-4 flex gap-1 rounded-lg bg-muted p-1">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const count = tab.value === "all" ? totalResults
                : tab.value === "goals" ? (data?.goals?.length ?? 0)
                : tab.value === "tasks" ? (data?.tasks?.length ?? 0)
                : tab.value === "conversations" ? (data?.conversations?.length ?? 0)
                : (data?.memories?.length ?? 0);
              return (
                <button
                  key={tab.value}
                  onClick={() => setActiveTab(tab.value)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    activeTab === tab.value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                  {data && <span className="text-xs opacity-60">({count})</span>}
                </button>
              );
            })}
          </div>

          {isLoading ? (
            <ListSkeleton rows={5} />
          ) : totalResults === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Search className="mb-3 h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">No results for &ldquo;{activeQuery}&rdquo;</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Goals */}
              {showGoals && data?.goals && data.goals.length > 0 && (
                <section>
                  {activeTab === "all" && (
                    <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <Target className="h-3.5 w-3.5" />
                      Goals ({data.goals.length})
                    </h2>
                  )}
                  <div className="space-y-2">
                    {data.goals.map((g) => (
                      <Card
                        key={g.id}
                        className="cursor-pointer hover:bg-accent/50 transition-colors"
                        onClick={() => navigate(`/dashboard/goals/${g.id}`)}
                      >
                        <CardContent className="pt-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium">{g.title}</p>
                              {g.description && (
                                <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{g.description}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge className={STATUS_COLORS[g.status] ?? ""}>{g.status}</Badge>
                              <span className="shrink-0 text-xs text-muted-foreground">{formatDate(g.createdAt)}</span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </section>
              )}

              {/* Tasks */}
              {showTasks && data?.tasks && data.tasks.length > 0 && (
                <section>
                  {activeTab === "all" && (
                    <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <ListChecks className="h-3.5 w-3.5" />
                      Tasks ({data.tasks.length})
                    </h2>
                  )}
                  <div className="space-y-2">
                    {data.tasks.map((t) => (
                      <Card
                        key={t.id}
                        className="cursor-pointer hover:bg-accent/50 transition-colors"
                        onClick={() => navigate(`/dashboard/goals/${t.goalId}`)}
                      >
                        <CardContent className="pt-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium">{t.title}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge className={STATUS_COLORS[t.status] ?? ""}>{t.status}</Badge>
                              <span className="shrink-0 text-xs text-muted-foreground">{formatDate(t.createdAt)}</span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </section>
              )}

              {/* Conversations */}
              {showConversations && data?.conversations && data.conversations.length > 0 && (
                <section>
                  {activeTab === "all" && (
                    <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <MessageSquare className="h-3.5 w-3.5" />
                      Conversations ({data.conversations.length})
                    </h2>
                  )}
                  <div className="space-y-2">
                    {data.conversations.map((c) => (
                      <Card
                        key={c.id}
                        className="cursor-pointer hover:bg-accent/50 transition-colors"
                        onClick={() => navigate(`/dashboard/chat?conversation=${c.id}`)}
                      >
                        <CardContent className="pt-3">
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-sm font-medium">{c.title || c.id.slice(0, 8)}</p>
                            <span className="shrink-0 text-xs text-muted-foreground">{formatDate(c.createdAt)}</span>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </section>
              )}

              {/* Memories */}
              {showMemories && data?.memories && data.memories.length > 0 && (
                <section>
                  {activeTab === "all" && (
                    <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <Brain className="h-3.5 w-3.5" />
                      Memories ({data.memories.length})
                    </h2>
                  )}
                  <div className="space-y-2">
                    {data.memories.map((m) => (
                      <Card key={m.id}>
                        <CardContent className="pt-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 mb-0.5">
                                <p className="text-sm font-medium">{m.key}</p>
                                <Badge variant="outline" className="text-xs">{m.category}</Badge>
                              </div>
                              <p className="text-xs text-muted-foreground line-clamp-2">{m.content}</p>
                            </div>
                            <span className="shrink-0 text-xs text-muted-foreground">{formatDate(m.createdAt)}</span>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </>
      )}

      {!activeQuery && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Search className="mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">Type to search across all data</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Goals, tasks, conversations, and memories
          </p>
        </div>
      )}
    </div>
  );
}
