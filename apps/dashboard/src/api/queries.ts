import { useQuery } from "@tanstack/react-query";
import { apiClient } from "./client";
import { queryKeys } from "@/lib/query-keys";

export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health.status,
    queryFn: () => apiClient.health(),
    refetchInterval: 60_000,
  });
}

export function useProviderHealth() {
  return useQuery({
    queryKey: queryKeys.health.providers,
    queryFn: () => apiClient.providerHealth(),
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
  });
}

export function usePendingApprovals() {
  return useQuery({
    queryKey: queryKeys.approvals.pending,
    queryFn: () => apiClient.listPendingApprovals(),
    refetchInterval: 30_000,
  });
}

export function useUsage(period?: "today" | "week" | "month" | "all") {
  return useQuery({
    queryKey: queryKeys.usage.summary(period),
    queryFn: () => apiClient.getUsage(period),
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
