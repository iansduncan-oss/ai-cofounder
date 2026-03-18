import { Badge } from "@/components/ui/badge";
import type { GoalStatus, TaskStatus, ApprovalStatus } from "@ai-cofounder/api-client";

const goalStatusConfig: Record<GoalStatus, { label: string; variant: "default" | "secondary" | "success" | "warning" | "destructive" }> = {
  draft: { label: "Draft", variant: "secondary" },
  proposed: { label: "Proposed", variant: "warning" },
  active: { label: "Active", variant: "default" },
  completed: { label: "Completed", variant: "success" },
  cancelled: { label: "Cancelled", variant: "destructive" },
  needs_review: { label: "Needs Review", variant: "warning" },
};

const taskStatusConfig: Record<TaskStatus, { label: string; variant: "default" | "secondary" | "success" | "warning" | "destructive" }> = {
  pending: { label: "Pending", variant: "secondary" },
  assigned: { label: "Assigned", variant: "warning" },
  running: { label: "Running", variant: "default" },
  completed: { label: "Completed", variant: "success" },
  failed: { label: "Failed", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "destructive" },
};

const approvalStatusConfig: Record<ApprovalStatus, { label: string; variant: "default" | "secondary" | "success" | "warning" | "destructive" }> = {
  pending: { label: "Pending", variant: "warning" },
  approved: { label: "Approved", variant: "success" },
  rejected: { label: "Rejected", variant: "destructive" },
};

export function GoalStatusBadge({ status }: { status: GoalStatus }) {
  const config = goalStatusConfig[status];
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const config = taskStatusConfig[status];
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

export function ApprovalStatusBadge({ status }: { status: ApprovalStatus }) {
  const config = approvalStatusConfig[status];
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
