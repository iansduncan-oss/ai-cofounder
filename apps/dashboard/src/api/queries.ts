import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import type { SubagentRunStatus } from "@ai-cofounder/api-client";
import { apiClient } from "./client";
import { queryKeys } from "@/lib/query-keys";

export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health.status,
    queryFn: () => apiClient.health(),
    // Health should be fresh — refetch every 15s
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useProviderHealth() {
  return useQuery({
    queryKey: queryKeys.health.providers,
    queryFn: () => apiClient.providerHealth(),
    // Provider health changes when circuit breakers trip — keep reasonably fresh
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useSelfHealingStatus() {
  return useQuery({
    queryKey: queryKeys.selfHealing.status,
    queryFn: () => apiClient.selfHealingStatus(),
    refetchInterval: 30_000,
  });
}

export function useSelfHealingReport() {
  return useQuery({
    queryKey: queryKeys.selfHealing.report,
    queryFn: () => apiClient.selfHealingReport(),
    refetchInterval: 60_000,
  });
}

export function useGoals(conversationId: string) {
  return useQuery({
    queryKey: queryKeys.goals.list(conversationId),
    queryFn: () => apiClient.listGoals(conversationId),
    enabled: !!conversationId,
  });
}

export function useGoal(id: string) {
  return useQuery({
    queryKey: queryKeys.goals.detail(id),
    queryFn: () => apiClient.getGoal(id),
    enabled: !!id,
  });
}

export function useGoalProgress(id: string) {
  return useQuery({
    queryKey: queryKeys.goals.progress(id),
    queryFn: () => apiClient.getProgress(id),
    enabled: !!id,
  });
}

export function useTasks(goalId: string) {
  return useQuery({
    queryKey: queryKeys.tasks.list(goalId),
    queryFn: () => apiClient.listTasks(goalId),
    enabled: !!goalId,
  });
}

export function usePendingTasks() {
  return useQuery({
    queryKey: queryKeys.tasks.pending,
    queryFn: () => apiClient.listPendingTasks(),
    // Pending tasks change as agents execute — keep fresh
    staleTime: 5_000,
    refetchInterval: 10_000,
  });
}

export function usePendingApprovals() {
  return useQuery({
    queryKey: queryKeys.approvals.pending,
    queryFn: () => apiClient.listPendingApprovals(),
    // Approvals are time-sensitive — user needs to see them immediately
    staleTime: 5_000,
    refetchInterval: 10_000,
  });
}

export function useUsage(period?: "today" | "week" | "month" | "all") {
  return useQuery({
    queryKey: queryKeys.usage.summary(period),
    queryFn: () => apiClient.getUsage(period),
  });
}

export function useDailyCost(days = 30) {
  return useQuery({
    queryKey: queryKeys.usage.daily(days),
    queryFn: () => apiClient.getDailyCost(days),
  });
}

export function useBudgetStatus() {
  return useQuery({
    queryKey: queryKeys.usage.budget,
    queryFn: () => apiClient.getBudgetStatus(),
    // Budget should be fresh — user needs to know when approaching limits
    staleTime: 10_000,
    refetchInterval: 60_000, // sync with budget check interval
  });
}

export function useCostByGoal(goalId: string) {
  return useQuery({
    queryKey: queryKeys.usage.byGoal(goalId),
    queryFn: () => apiClient.getCostByGoal(goalId),
    enabled: !!goalId,
  });
}

export function useTopExpensiveGoals(limit?: number) {
  return useQuery({
    queryKey: queryKeys.usage.topGoals(limit),
    queryFn: () => apiClient.getTopExpensiveGoals({ limit }),
  });
}

export function useMemories(userId: string) {
  return useQuery({
    queryKey: queryKeys.memories.list(userId),
    queryFn: () => apiClient.listMemories(userId),
    enabled: !!userId,
  });
}

export function useMilestones(conversationId: string) {
  return useQuery({
    queryKey: queryKeys.milestones.list(conversationId),
    queryFn: () => apiClient.listMilestones(conversationId),
    enabled: !!conversationId,
  });
}

export function useMilestoneProgress(id: string) {
  return useQuery({
    queryKey: queryKeys.milestones.progress(id),
    queryFn: () => apiClient.getMilestoneProgress(id),
    enabled: !!id,
  });
}

export function useDirectoryListing(path: string) {
  return useQuery({
    queryKey: queryKeys.workspace.tree(path),
    queryFn: () => apiClient.listDirectory(path),
  });
}

export function useFileContent(path: string | null) {
  return useQuery({
    queryKey: queryKeys.workspace.file(path ?? ""),
    queryFn: () => apiClient.readFile(path!),
    enabled: !!path,
  });
}

export function useDashboardUser() {
  return useQuery({
    queryKey: ["dashboard-user"],
    queryFn: () => apiClient.getUserByPlatform("dashboard", "dashboard-user"),
    staleTime: Infinity,
  });
}

export function useQuickActions() {
  return useQuery({
    queryKey: ["quick-actions"],
    queryFn: () => apiClient.getQuickActions(),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

export function useConversations(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.conversations.list(userId ?? ""),
    queryFn: () => apiClient.listConversations(userId!),
    enabled: !!userId,
  });
}

export function useConversationMessages(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.conversations.messages(id ?? ""),
    queryFn: () => apiClient.getConversationMessages(id!, { limit: 200 }),
    enabled: !!id,
  });
}

export function useMonitoringStatus() {
  return useQuery({
    queryKey: queryKeys.monitoring.status,
    queryFn: () => apiClient.getMonitoringStatus(),
  });
}

export function useQueueStatus() {
  return useQuery({
    queryKey: queryKeys.queue.status,
    queryFn: () => apiClient.getQueueStatus(),
  });
}

export function useBriefing() {
  return useQuery({
    queryKey: queryKeys.briefing.latest,
    queryFn: () => apiClient.getBriefing(),
  });
}

export function useToolStats() {
  return useQuery({
    queryKey: queryKeys.tools.stats,
    queryFn: () => apiClient.getToolStats(),
  });
}

export function useErrorSummary(hours = 24) {
  return useQuery({
    queryKey: queryKeys.errors.summary(hours),
    queryFn: () => apiClient.getErrorSummary(hours),
    refetchInterval: 60_000,
  });
}

export function useActivePersona() {
  return useQuery({
    queryKey: queryKeys.persona.active,
    queryFn: () => apiClient.getActivePersona(),
  });
}

export function useListPipelines() {
  return useQuery({
    queryKey: queryKeys.pipelines.list,
    queryFn: () => apiClient.listPipelines(),
  });
}

export function usePipeline(jobId: string | null) {
  return useQuery({
    queryKey: queryKeys.pipelines.detail(jobId ?? ""),
    queryFn: () => apiClient.getPipeline(jobId!),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      if (state === "completed" || state === "failed") return false;
      return 5_000;
    },
  });
}

export function useListPersonas() {
  return useQuery({
    queryKey: queryKeys.persona.list,
    queryFn: () => apiClient.listPersonas(),
    // Personas rarely change — 5 minute staleTime
    staleTime: 5 * 60_000,
  });
}

export function usePatterns(userId?: string, includeInactive?: boolean) {
  return useQuery({
    queryKey: queryKeys.patterns.list(userId),
    queryFn: () => apiClient.listPatterns(userId, includeInactive),
  });
}

export function usePatternAnalytics(userId?: string) {
  return useQuery({
    queryKey: queryKeys.patterns.analytics(userId),
    queryFn: () => apiClient.getPatternAnalytics(userId),
  });
}

export function useToolTierConfig() {
  return useQuery({
    queryKey: queryKeys.autonomy.tiers,
    queryFn: () => apiClient.listToolTierConfig(),
  });
}

export function useDlqJobs() {
  return useQuery({
    queryKey: queryKeys.dlq.all,
    queryFn: () => apiClient.listDlqJobs(),
    refetchInterval: 30_000,
  });
}

export function useSubagentRuns(status?: SubagentRunStatus) {
  return useQuery({
    queryKey: queryKeys.subagents.list(status),
    queryFn: () => apiClient.listSubagentRuns(status ? { status } : undefined),
    refetchInterval: 10_000,
  });
}

export function useDashboardSummary() {
  return useQuery({
    queryKey: queryKeys.dashboard.summary,
    queryFn: () => apiClient.getDashboardSummary(),
    refetchInterval: 60_000,
  });
}

export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects.list,
    queryFn: () => apiClient.listProjects(),
    staleTime: 60_000,
  });
}

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings.current,
    queryFn: () => apiClient.getSettings(),
  });
}

export function useAutonomousSessions(limit = 20) {
  return useQuery({
    queryKey: queryKeys.autonomous.sessions,
    queryFn: () => apiClient.listAutonomousSessions(limit),
    refetchInterval: 30_000,
  });
}

export function useWorkSessions(params?: { limit?: number; offset?: number; goalId?: string }) {
  return useQuery({
    queryKey: [...queryKeys.workSessions.list, params] as const,
    queryFn: () => apiClient.listWorkSessions(params),
    refetchInterval: 30_000,
  });
}

export function useGmailInbox(maxResults?: number) {
  return useQuery({
    queryKey: [...queryKeys.gmail.inbox, maxResults ?? "default"] as const,
    queryFn: () => apiClient.listGmailMessages(maxResults ? { maxResults } : undefined),
  });
}

export function useGmailMessage(id: string | null) {
  return useQuery({
    queryKey: queryKeys.gmail.message(id ?? ""),
    queryFn: () => apiClient.getGmailMessage(id!),
    enabled: !!id,
  });
}

export function useGmailThread(id: string | null) {
  return useQuery({
    queryKey: queryKeys.gmail.thread(id ?? ""),
    queryFn: () => apiClient.getGmailThread(id!),
    enabled: !!id,
  });
}

export function useGmailSearch(q: string) {
  return useQuery({
    queryKey: queryKeys.gmail.search(q),
    queryFn: () => apiClient.searchGmail(q),
    enabled: q.length > 0,
  });
}

export function useGmailUnreadCount() {
  return useQuery({
    queryKey: queryKeys.gmail.unreadCount,
    queryFn: () => apiClient.getGmailUnreadCount(),
    refetchInterval: 60_000,
  });
}

export function useCalendarEvents(params?: {
  timeMin?: string;
  timeMax?: string;
  maxResults?: number;
}) {
  return useQuery({
    queryKey: [...queryKeys.calendar.events, params ?? "default"] as const,
    queryFn: () => apiClient.listCalendarEvents(params),
  });
}

export function useCalendarEvent(id: string | null) {
  return useQuery({
    queryKey: queryKeys.calendar.event(id ?? ""),
    queryFn: () => apiClient.getCalendarEvent(id!),
    enabled: !!id,
  });
}

export function useCalendarSearch(q: string) {
  return useQuery({
    queryKey: queryKeys.calendar.search(q),
    queryFn: () => apiClient.searchCalendarEvents(q),
    enabled: q.length > 0,
  });
}

export function useMeetingPrep(eventId: string | null) {
  return useQuery({
    queryKey: queryKeys.calendar.prep(eventId ?? ""),
    queryFn: () => apiClient.getMeetingPrep(eventId!),
    enabled: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function useTodayBriefing(refresh = false) {
  return useQuery({
    queryKey: queryKeys.briefing.today,
    queryFn: () => apiClient.getTodayBriefing(refresh),
  });
}

export function useFollowUps(status?: "pending" | "done" | "dismissed") {
  return useQuery({
    queryKey: queryKeys.followUps.list(status),
    queryFn: () => apiClient.listFollowUps({ status }),
  });
}

export function useFollowUp(id: string) {
  return useQuery({
    queryKey: queryKeys.followUps.detail(id),
    queryFn: () => apiClient.getFollowUp(id),
    enabled: !!id,
  });
}

export function useDecisions(userId: string, search?: string) {
  return useQuery({
    queryKey: queryKeys.decisions.list(userId),
    queryFn: () => apiClient.listDecisions(userId, { q: search, limit: 100 }),
    enabled: !!userId,
  });
}

export function usePipelineTemplates() {
  return useQuery({
    queryKey: queryKeys.pipelineTemplates.list,
    queryFn: () => apiClient.listPipelineTemplates(),
  });
}

export function useEvents(filters?: { source?: string; type?: string; processed?: boolean }) {
  const filterKey = JSON.stringify(filters ?? {});
  return useQuery({
    queryKey: queryKeys.events.list(filterKey),
    queryFn: () => apiClient.listEvents({ limit: 100, ...filters }),
    refetchInterval: 30_000,
  });
}

export function useReprocessEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.reprocessEvent(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.events.all });
    },
  });
}

export function useGlobalSearch(q: string) {
  return useQuery({
    queryKey: queryKeys.search.results(q),
    queryFn: () => apiClient.globalSearch(q),
    enabled: q.length >= 2,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useLatestDeployment() {
  return useQuery({
    queryKey: queryKeys.deploys.latest,
    queryFn: () => apiClient.getLatestDeployment(),
  });
}

export function useDeployments(limit = 20) {
  return useQuery({
    queryKey: queryKeys.deploys.list,
    queryFn: () => apiClient.listDeployments(limit),
  });
}

/* ── Goal Analytics ── */

export function useGoalAnalytics() {
  return useQuery({
    queryKey: queryKeys.goals.analytics,
    queryFn: () => apiClient.getGoalAnalytics(),
  });
}

/* ── Thinking Traces ── */

export function useThinkingTraces(conversationId: string) {
  return useQuery({
    queryKey: queryKeys.thinking.traces(conversationId),
    queryFn: () => apiClient.getThinkingTraces(conversationId),
    enabled: !!conversationId,
  });
}

/* ── Reflections ── */

export function useReflections(type?: string) {
  return useQuery({
    queryKey: queryKeys.reflections.list(type),
    queryFn: () => apiClient.listReflections({ type, limit: 50 }),
  });
}

export function useReflectionStats() {
  return useQuery({
    queryKey: queryKeys.reflections.stats,
    queryFn: () => apiClient.getReflectionStats(),
  });
}

/* ── Agent Info ── */

export function useAgentCapabilities() {
  return useQuery({
    queryKey: queryKeys.agents.capabilities,
    queryFn: () => apiClient.getAgentCapabilities(),
    staleTime: 5 * 60_000, // static data, cache 5 min
  });
}

/* ── Schedules ── */

export function useSchedules() {
  return useQuery({
    queryKey: queryKeys.schedules.list,
    queryFn: () => apiClient.listSchedules(),
  });
}

/* ── Knowledge / RAG ── */

/* ── Routing Stats ── */

export function useRoutingStats() {
  return useQuery({
    queryKey: queryKeys.routing.stats,
    queryFn: () => apiClient.getRoutingStats(),
    refetchInterval: 30_000,
  });
}

export function useKnowledgeStatus() {
  return useQuery({
    queryKey: queryKeys.knowledge.status,
    queryFn: () => apiClient.ragStatus(),
  });
}

export function useKnowledgeSearch(query: string) {
  return useQuery({
    queryKey: queryKeys.knowledge.search(query),
    queryFn: () => apiClient.ragSearch(query),
    enabled: query.length >= 2,
    placeholderData: keepPreviousData,
  });
}

/* ── Productivity ── */

export function useProductivityToday() {
  return useQuery({
    queryKey: queryKeys.productivity.today,
    queryFn: () => apiClient.getProductivityToday(),
  });
}

export function useProductivityStats(days?: number) {
  return useQuery({
    queryKey: queryKeys.productivity.stats(days),
    queryFn: () => apiClient.getProductivityStats(days),
  });
}

export function useProductivityHistory(opts?: { limit?: number; from?: string; to?: string }) {
  const key = opts ? JSON.stringify(opts) : "";
  return useQuery({
    queryKey: queryKeys.productivity.history(key),
    queryFn: () => apiClient.getProductivityHistory(opts),
  });
}

export function useProductivityNext() {
  return useQuery({
    queryKey: ["productivity", "next"] as const,
    queryFn: () => apiClient.getProductivityNext(),
    // Don't refetch on every render — live-update via WS productivity channel
    staleTime: 30_000,
  });
}

export function useProductivityWeekly(enabled = true) {
  return useQuery({
    queryKey: queryKeys.productivity.weekly,
    queryFn: () => apiClient.getProductivityWeekly(),
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes — LLM call is expensive
  });
}

/* ── Codebase Insights ── */

export function useCodebaseInsights(status: "open" | "dismissed" | "resolved" = "open") {
  return useQuery({
    queryKey: queryKeys.codebase.insights(status),
    queryFn: () => apiClient.listCodebaseInsights({ status, limit: 20 }),
  });
}

export function useCodebaseInsightsCount() {
  return useQuery({
    queryKey: queryKeys.codebase.count,
    queryFn: () => apiClient.getCodebaseInsightsCount(),
  });
}
