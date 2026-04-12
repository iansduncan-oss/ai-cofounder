import type { AgentRole } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import type { SpecialistAgent } from "../specialists/base.js";
import type { NotificationService } from "../../services/notifications.js";
import type { PlanRepairService } from "../../services/plan-repair.js";
import type { ProceduralMemoryService } from "../../services/procedural-memory.js";
import type { AdaptiveRoutingService } from "../../services/adaptive-routing.js";
import type { SelfHealingService } from "../../services/self-healing.js";

export interface DispatcherProgress {
  goalId: string;
  goalTitle: string;
  status: string;
  totalTasks: number;
  completedTasks: number;
  currentTask?: { id: string; title: string; agent: string; status: string };
  tasks: Array<{
    id: string;
    title: string;
    agent: string;
    status: string;
    output?: string;
  }>;
}

export type TaskProgressCallback = (event: {
  goalId: string;
  goalTitle: string;
  taskId: string;
  taskTitle: string;
  agent: string;
  status: "started" | "completed" | "failed";
  completedTasks: number;
  totalTasks: number;
  output?: string;
}) => void | Promise<void>;

/**
 * Shared dependencies passed to sub-modules so they don't need to hold a TaskDispatcher reference.
 */
export interface DispatcherDeps {
  db: Db;
  specialists: Map<AgentRole, SpecialistAgent>;
  notificationService?: NotificationService;
  planRepairService?: PlanRepairService;
  proceduralMemoryService?: ProceduralMemoryService;
  adaptiveRoutingService?: AdaptiveRoutingService;
  selfHealingService?: SelfHealingService;
}

export const RETRYABLE_ROLES: Set<AgentRole> = new Set(["coder", "debugger", "doc_writer"]);
export const MAX_RETRIES = 1;
