import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "./client";
import { queryKeys } from "@/lib/query-keys";
import type { GoalStatus, UpsertPersonaInput, SubmitPipelineInput, AutonomyTier, CreateProjectInput, SendEmailInput, CreateCalendarEventInput, UpdateCalendarEventInput, CreateFollowUpInput, UpdateFollowUpInput } from "@ai-cofounder/api-client";

export function useResolveApproval() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      status,
      decision,
      decidedBy,
    }: {
      id: string;
      status: "approved" | "rejected";
      decision: string;
      decidedBy?: string;
    }) => apiClient.resolveApproval(id, { status, decision, decidedBy }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all });
      toast.success(
        variables.status === "approved"
          ? "Approval granted"
          : "Request rejected",
      );
    },
    onError: (err) => {
      toast.error(`Failed to resolve approval: ${err.message}`);
    },
  });
}

export function useExecuteGoal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      goalId,
      userId,
    }: {
      goalId: string;
      userId?: string;
    }) => apiClient.executeGoal(goalId, { userId }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.goals.detail(variables.goalId),
      });
      toast.success("Goal execution started");
    },
    onError: (err) => {
      toast.error(`Failed to execute goal: ${err.message}`);
    },
  });
}

export function useUpdateGoalStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: GoalStatus;
    }) => apiClient.updateGoalStatus(id, status),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.goals.detail(variables.id),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.goals.all });
      toast.success(`Goal status updated to ${variables.status}`);
    },
    onError: (err) => {
      toast.error(`Failed to update goal: ${err.message}`);
    },
  });
}

export function useApproveGoal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.approveGoal(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.goals.detail(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.goals.all });
      toast.success("Goal approved — execution can now proceed");
    },
    onError: (err) => {
      toast.error(`Failed to approve goal: ${err.message}`);
    },
  });
}

export function useRejectGoal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      apiClient.rejectGoal(id, reason),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.goals.detail(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.goals.all });
      toast.success("Goal rejected");
    },
    onError: (err) => {
      toast.error(`Failed to reject goal: ${err.message}`);
    },
  });
}

export function useRunAgent() {
  return useMutation({
    mutationFn: (data: {
      message: string;
      conversationId?: string;
      userId?: string;
    }) => apiClient.runAgent(data),
    onError: (err) => {
      toast.error(`Agent error: ${err.message}`);
    },
  });
}

export function useDeleteMemory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.deleteMemory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.memories.all });
      toast.success("Memory deleted");
    },
    onError: (err) => {
      toast.error(`Failed to delete memory: ${err.message}`);
    },
  });
}

export function useCreateGoal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      conversationId: string;
      title: string;
      description?: string;
      priority?: "low" | "medium" | "high" | "critical";
    }) => apiClient.createGoal(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.goals.all });
      toast.success("Goal created");
    },
    onError: (err) => {
      toast.error(`Failed to create goal: ${err.message}`);
    },
  });
}

export function useUpdateMilestoneStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: "planned" | "in_progress" | "completed" | "cancelled";
    }) => apiClient.updateMilestoneStatus(id, status),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.milestones.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.milestones.detail(variables.id),
      });
      toast.success(`Milestone status updated to ${variables.status}`);
    },
    onError: (err) => {
      toast.error(`Failed to update milestone: ${err.message}`);
    },
  });
}

export function useSubmitGoalPipeline() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      goalId,
      context,
    }: {
      goalId: string;
      context?: Record<string, unknown>;
    }) => apiClient.submitGoalPipeline(goalId, context),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pipelines.all });
      toast.success(`Pipeline submitted — Job ${data.jobId.slice(0, 8)}`);
    },
    onError: (err) => {
      toast.error(`Failed to submit pipeline: ${err.message}`);
    },
  });
}

export function useSubmitPipeline() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: SubmitPipelineInput) => apiClient.submitPipeline(data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pipelines.all });
      toast.success(`Pipeline queued — Job ${data.jobId.slice(0, 8)}`);
    },
    onError: (err) => {
      toast.error(`Failed to submit pipeline: ${err.message}`);
    },
  });
}

export function useUpsertPersona() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpsertPersonaInput) => apiClient.upsertPersona(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.persona.all });
      toast.success("Persona saved");
    },
    onError: (err) => {
      toast.error(`Failed to save persona: ${err.message}`);
    },
  });
}

export function useCancelPipeline() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (jobId: string) => apiClient.cancelPipeline(jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pipelines.all });
      toast.success("Pipeline cancelled");
    },
    onError: (err) => {
      toast.error(`Failed to cancel pipeline: ${err.message}`);
    },
  });
}

export function useRetryPipeline() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (jobId: string) => apiClient.retryPipeline(jobId),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pipelines.all });
      toast.success(`Pipeline retried — Job ${data.jobId.slice(0, 8)}`);
    },
    onError: (err) => {
      toast.error(`Failed to retry pipeline: ${err.message}`);
    },
  });
}

export function useDeletePersona() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.deletePersona(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.persona.all });
      toast.success("Persona deleted");
    },
    onError: (err) => {
      toast.error(`Failed to delete persona: ${err.message}`);
    },
  });
}

export function useTogglePattern() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiClient.togglePattern(id, isActive),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.patterns.all });
      toast.success("Pattern updated");
    },
    onError: (err) => {
      toast.error(`Failed to toggle pattern: ${err.message}`);
    },
  });
}

export function useDeletePattern() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.deletePattern(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.patterns.all });
      toast.success("Pattern deleted");
    },
    onError: (err) => {
      toast.error(`Failed to delete pattern: ${err.message}`);
    },
  });
}

export function useCreatePattern() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      patternType: string;
      description: string;
      suggestedAction: string;
      userId?: string;
      triggerCondition?: Record<string, unknown>;
      confidence?: number;
    }) => apiClient.createPattern(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.patterns.all });
      toast.success("Pattern created");
    },
    onError: (err) => {
      toast.error(`Failed to create pattern: ${err.message}`);
    },
  });
}

export function useUpdatePattern() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      description?: string;
      suggestedAction?: string;
      triggerCondition?: Record<string, unknown>;
      confidence?: number;
      isActive?: boolean;
    }) => apiClient.updatePattern(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.patterns.all });
      toast.success("Pattern updated");
    },
    onError: (err) => {
      toast.error(`Failed to update pattern: ${err.message}`);
    },
  });
}

export function useAcceptSuggestion() {
  return useMutation({
    mutationFn: (data: { suggestion: string; userId?: string; patternId?: string }) =>
      apiClient.acceptSuggestion(data),
  });
}

export function useUpdateToolTier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { toolName: string; tier: AutonomyTier }) =>
      apiClient.updateToolTier(data.toolName, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.autonomy.tiers }),
    onError: (err) => {
      toast.error(`Failed to update tier: ${err.message}`);
    },
  });
}

export function useRetryDlqJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dlqJobId: string) => apiClient.retryDlqJob(dlqJobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dlq.all });
      toast.success("DLQ job retried");
    },
    onError: (err) => {
      toast.error(`Failed to retry DLQ job: ${err.message}`);
    },
  });
}

export function useDeleteDlqJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dlqJobId: string) => apiClient.deleteDlqJob(dlqJobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dlq.all });
      toast.success("DLQ job deleted");
    },
    onError: (err) => {
      toast.error(`Failed to delete DLQ job: ${err.message}`);
    },
  });
}

export function useCancelSubagentRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.cancelSubagentRun(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.subagents.all });
      toast.success("Subagent run cancelled");
    },
    onError: (err) => {
      toast.error(`Failed to cancel subagent run: ${err.message}`);
    },
  });
}

export function useUpdateBudgetThresholds() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { dailyUsd: number; weeklyUsd: number }) =>
      apiClient.updateBudgetThresholds(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.settings.all });
      qc.invalidateQueries({ queryKey: queryKeys.usage.budget });
      toast.success("Budget thresholds updated");
    },
    onError: (err) => {
      toast.error(`Failed to update budget: ${err.message}`);
    },
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateProjectInput) => apiClient.createProject(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projects.all });
      toast.success("Project registered");
    },
    onError: (err) => {
      toast.error(`Failed to register project: ${err.message}`);
    },
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.deleteProject(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projects.all });
      toast.success("Project removed");
    },
    onError: (err) => {
      toast.error(`Failed to delete project: ${err.message}`);
    },
  });
}

export function useSendGmailMessage() {
  return useMutation({
    mutationFn: (input: SendEmailInput) => apiClient.sendGmailMessage(input),
    onSuccess: () => { toast.success("Email sent"); },
    onError: (err) => { toast.error(`Failed to send email: ${err.message}`); },
  });
}

export function useCreateGmailDraft() {
  return useMutation({
    mutationFn: (input: SendEmailInput) => apiClient.createGmailDraft(input),
    onSuccess: () => { toast.success("Draft saved"); },
    onError: (err) => { toast.error(`Failed to create draft: ${err.message}`); },
  });
}

export function useMarkGmailRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => apiClient.markGmailRead(messageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.gmail.all });
    },
  });
}

export function useCreateCalendarEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCalendarEventInput) => apiClient.createCalendarEvent(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all });
      toast.success("Event created");
    },
    onError: (err) => { toast.error(`Failed to create event: ${err.message}`); },
  });
}

export function useUpdateCalendarEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, ...input }: UpdateCalendarEventInput & { eventId: string }) =>
      apiClient.updateCalendarEvent(eventId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all });
      toast.success("Event updated");
    },
    onError: (err) => { toast.error(`Failed to update event: ${err.message}`); },
  });
}

export function useDeleteCalendarEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) => apiClient.deleteCalendarEvent(eventId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all });
      toast.success("Event deleted");
    },
    onError: (err) => { toast.error(`Failed to delete event: ${err.message}`); },
  });
}

export function useRespondToCalendarEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, responseStatus }: { eventId: string; responseStatus: "accepted" | "declined" | "tentative" }) =>
      apiClient.respondToCalendarEvent(eventId, responseStatus),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all });
      toast.success("RSVP sent");
    },
    onError: (err) => { toast.error(`Failed to RSVP: ${err.message}`); },
  });
}

/* ── Follow-Ups ── */

export function useCreateFollowUp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateFollowUpInput) => apiClient.createFollowUp(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.followUps.all });
      toast.success("Follow-up created");
    },
    onError: (err) => { toast.error(`Failed to create follow-up: ${err.message}`); },
  });
}

export function useUpdateFollowUp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateFollowUpInput }) =>
      apiClient.updateFollowUp(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.followUps.all });
      toast.success("Follow-up updated");
    },
    onError: (err) => { toast.error(`Failed to update follow-up: ${err.message}`); },
  });
}

export function useDeleteFollowUp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.deleteFollowUp(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.followUps.all });
      toast.success("Follow-up deleted");
    },
    onError: (err) => { toast.error(`Failed to delete follow-up: ${err.message}`); },
  });
}

export function useTriggerPipelineTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, goalId, context }: { name: string; goalId?: string; context?: Record<string, unknown> }) =>
      apiClient.triggerPipelineTemplate(name, { goalId, context }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pipelines.all });
      toast.success(`Pipeline triggered: ${data.template}`);
    },
    onError: (err) => { toast.error(`Failed to trigger template: ${err.message}`); },
  });
}
