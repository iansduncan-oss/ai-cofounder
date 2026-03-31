import type {
  LlmRegistry,
  LlmTool,
  LlmMessage,
  LlmToolUseContent,
  LlmToolResultContent,
  LlmTextContent,
  LlmThinkingContent,
  TaskCategory,
  EmbeddingService,
} from "@ai-cofounder/llm";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import type { AgentRole, AgentMessage, GoalScope } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import { retrieve, formatContext } from "@ai-cofounder/rag";
import {
  createGoal,
  createTask,
  updateGoalStatus,
  updateTaskDependencies,
  recallMemories,
  searchMemoriesByVector,
  createApproval,
  createMilestone,
  recordToolExecution,
  getConversation,
  saveThinkingTrace,
  recordLlmUsage,
} from "@ai-cofounder/db";
import { buildSystemPrompt, sanitizeForPrompt } from "./prompts/system.js";
import { SessionContextService } from "../services/session-context.js";

/** Tools that require explicit user confirmation before execution */
const CONFIRMATION_REQUIRED_TOOLS = new Set(["delete_file", "delete_directory", "git_push"]);
import { ContextualAwarenessService } from "../services/contextual-awareness.js";
import { recordToolMetrics } from "../plugins/observability.js";
import { recordActionSafe } from "../services/action-recorder.js";
import type { StreamCallback } from "./stream-events.js";
import type { N8nService } from "../services/n8n.js";
import type { WorkspaceService } from "../services/workspace.js";
import type { SandboxService } from "@ai-cofounder/sandbox";
import { notifyApprovalCreated, notifyGoalProposed } from "../services/notifications.js";
import { classifyGoalScope, scopeRequiresApproval } from "../services/scope-classifier.js";
import { buildSharedToolList, executeWithTierCheck, type ToolExecutorContext } from "./tool-executor.js";
import type { AgentMessagingService } from "../services/agent-messaging.js";
import type { AutonomyTierService } from "../services/autonomy-tier.js";
import type { ProjectRegistryService } from "../services/project-registry.js";
import type { MonitoringService } from "../services/monitoring.js";
import type { BrowserService } from "../services/browser.js";
import type { GmailService } from "../services/gmail.js";
import type { CalendarService } from "../services/calendar.js";
import type { EpisodicMemoryService } from "../services/episodic-memory.js";
import type { ProceduralMemoryService } from "../services/procedural-memory.js";
import type { PrReviewService } from "../services/pr-review.js";
import type { OutboundWebhookService } from "../services/outbound-webhooks.js";
import type { ConversationBranchingService } from "../services/conversation-branching.js";
import type { DiscordService } from "../services/discord.js";
import type { VpsCommandService } from "../services/vps-command.js";
import { ToolCache } from "../services/tool-cache.js";
import { ToolEfficacyService } from "../services/tool-efficacy.js";
import {
  DELEGATE_TO_SUBAGENT_TOOL,
  DELEGATE_PARALLEL_TOOL,
  CHECK_SUBAGENT_TOOL,
} from "./tools/subagent-tools.js";
import {
  createSubagentRun,
  getSubagentRun,
} from "@ai-cofounder/db";
import { enqueueSubagentTask } from "@ai-cofounder/queue";

/* ── Result types ── */

export interface PlanResult {
  goalId: string;
  goalTitle: string;
  scope?: GoalScope;
  requiresApproval?: boolean;
  tasks: Array<{
    id: string;
    title: string;
    assignedAgent: AgentRole;
    orderIndex: number;
    parallelGroup?: number | null;
    dependsOn?: string[] | null;
  }>;
}

export interface OrchestratorResult {
  conversationId: string;
  agentRole: AgentRole;
  response: string;
  model: string;
  provider?: string;
  usage?: { inputTokens: number; outputTokens: number };
  plan?: PlanResult;
  suggestions?: string[];
}

/* ── Tool definition for LLM ── */

const CREATE_PLAN_TOOL: LlmTool = {
  name: "create_plan",
  description:
    "Decompose a user request into a goal with ordered tasks assigned to specialist agents. " +
    "Use this when a request involves multiple steps, requires research, code, or review, " +
    "or would benefit from structured planning. Do NOT use for simple questions.",
  input_schema: {
    type: "object",
    properties: {
      goal_title: {
        type: "string",
        description: "Concise title for the overall goal (2-8 words)",
      },
      goal_description: {
        type: "string",
        description: "Full description of what needs to be accomplished",
      },
      goal_priority: {
        type: "string",
        enum: ["low", "medium", "high", "critical"],
        description: "Priority level based on urgency and importance",
      },
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Short task title (2-8 words)",
            },
            description: {
              type: "string",
              description: "What this task involves and expected output",
            },
            assigned_agent: {
              type: "string",
              enum: ["researcher", "coder", "reviewer", "planner"],
              description:
                "Which specialist agent should handle this task: " +
                "researcher (gather info), coder (write/edit code), " +
                "reviewer (critique/validate), planner (break down further)",
            },
            parallel_group: {
              type: "integer",
              description:
                "Optional group number for parallel execution. Tasks with the same group run concurrently. " +
                "Groups execute sequentially (0 before 1 before 2). Omit to run sequentially.",
            },
            depends_on: {
              type: "array",
              items: { type: "integer" },
              description:
                "Optional array of zero-based task indices that must complete before this task runs. " +
                "Enables DAG-based parallel execution. Tasks with no dependencies run as soon as possible " +
                "(up to concurrency limit). Prefer this over parallel_group for complex dependencies.",
            },
          },
          required: ["title", "description", "assigned_agent"],
        },
        description: "Ordered list of tasks to complete the goal",
      },
      milestone_id: {
        type: "string",
        description: "Optional milestone ID to associate this goal with (from create_milestone)",
      },
      scope: {
        type: "string",
        enum: ["read_only", "local", "external", "destructive"],
        description:
          "Estimated scope of the plan's side effects: " +
          "read_only (only reads data), local (modifies local files/code), " +
          "external (sends emails, deploys, pushes code), destructive (deletes data, drops tables). " +
          "Plans with external or destructive scope require human approval before execution.",
      },
    },
    required: ["goal_title", "goal_description", "goal_priority", "tasks"],
  },
};

const REQUEST_APPROVAL_TOOL: LlmTool = {
  name: "request_approval",
  description:
    "Request human approval before executing a sensitive or high-impact action. " +
    "Use this when a plan involves: deploying code, spending money, sending external communications, " +
    "deleting data, changing infrastructure, or any action that's hard to reverse. " +
    "The user will be notified and must approve via Discord before execution continues.",
  input_schema: {
    type: "object",
    properties: {
      task_id: {
        type: "string",
        description: "ID of the task that needs approval (from a previously created plan)",
      },
      reason: {
        type: "string",
        description: "Clear explanation of what will happen and why approval is needed (1-3 sentences)",
      },
    },
    required: ["task_id", "reason"],
  },
};

const CREATE_MILESTONE_TOOL: LlmTool = {
  name: "create_milestone",
  description:
    "Create a milestone that groups related goals into a phased plan with dependencies. " +
    "Use this for complex multi-step projects that span multiple goals. " +
    "After creating a milestone, use create_plan to add goals to it.",
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Milestone title describing the overall objective",
      },
      description: {
        type: "string",
        description: "Full description of what this milestone achieves",
      },
      order_index: {
        type: "number",
        description: "Order in the overall project plan (0-based)",
      },
      due_date: {
        type: "string",
        description: "Optional target date in ISO-8601 format",
      },
    },
    required: ["title", "description"],
  },
};

/* ── Internal types ── */

interface CreatePlanInput {
  goal_title: string;
  goal_description: string;
  goal_priority: "low" | "medium" | "high" | "critical";
  milestone_id?: string;
  scope?: GoalScope;
  tasks: Array<{
    title: string;
    description: string;
    assigned_agent: "researcher" | "coder" | "reviewer" | "planner";
    parallel_group?: number;
    depends_on?: number[];
  }>;
}

/**
 * Validate that a dependency graph (expressed as zero-based task indices) has no cycles.
 * Uses Kahn's algorithm for topological sort — if not all nodes are visited, a cycle exists.
 */
export function validateDependencyGraph(tasks: CreatePlanInput["tasks"]): void {
  const n = tasks.length;
  const inDegree = new Array<number>(n).fill(0);
  const adj = new Array<number[]>(n);
  for (let i = 0; i < n; i++) adj[i] = [];

  for (let i = 0; i < n; i++) {
    const deps = tasks[i].depends_on;
    if (!deps) continue;
    for (const dep of deps) {
      if (dep < 0 || dep >= n || dep === i) {
        throw new Error(`Task ${i} has invalid dependency index ${dep}`);
      }
      adj[dep].push(i);
      inDegree[i]++;
    }
  }

  // Kahn's algorithm
  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (inDegree[i] === 0) queue.push(i);
  }

  let visited = 0;
  while (queue.length > 0) {
    const node = queue.shift()!;
    visited++;
    for (const neighbor of adj[node]) {
      inDegree[neighbor]--;
      if (inDegree[neighbor] === 0) queue.push(neighbor);
    }
  }

  if (visited < n) {
    throw new Error("Dependency cycle detected in task graph");
  }
}

/* ── Orchestrator options ── */

export interface OrchestratorOptions {
  registry: LlmRegistry;
  db?: Db;
  taskCategory?: TaskCategory;
  embeddingService?: EmbeddingService;
  n8nService?: N8nService;
  sandboxService?: SandboxService;
  workspaceService?: WorkspaceService;
  messagingService?: AgentMessagingService;
  autonomyTierService?: AutonomyTierService;
  projectRegistryService?: ProjectRegistryService;
  monitoringService?: MonitoringService;
  browserService?: BrowserService;
  gmailService?: GmailService;
  calendarService?: CalendarService;
  episodicMemoryService?: EpisodicMemoryService;
  proceduralMemoryService?: ProceduralMemoryService;
  prReviewService?: PrReviewService;
  outboundWebhookService?: OutboundWebhookService;
  conversationBranchingService?: ConversationBranchingService;
  discordService?: DiscordService;
  vpsCommandService?: VpsCommandService;
  isAutonomous?: boolean;
}

/* ── Orchestrator class ── */

export class Orchestrator {
  private logger = createLogger("orchestrator");
  private db?: Db;
  private registry: LlmRegistry;
  private taskCategory: TaskCategory;
  private embeddingService?: EmbeddingService;
  private n8nService?: N8nService;
  private sandboxService?: SandboxService;
  private workspaceService?: WorkspaceService;
  private messagingService?: AgentMessagingService;
  private autonomyTierService?: AutonomyTierService;
  private projectRegistryService?: ProjectRegistryService;
  private monitoringService?: MonitoringService;
  private browserService?: BrowserService;
  private gmailService?: GmailService;
  private calendarService?: CalendarService;
  private episodicMemoryService?: EpisodicMemoryService;
  private proceduralMemoryService?: ProceduralMemoryService;
  private prReviewService?: PrReviewService;
  private outboundWebhookService?: OutboundWebhookService;
  private conversationBranchingService?: ConversationBranchingService;
  private discordService?: DiscordService;
  private vpsCommandService?: VpsCommandService;
  private isAutonomous: boolean;
  private requestId?: string;

  constructor(options: OrchestratorOptions) {
    this.registry = options.registry;
    this.db = options.db;
    this.taskCategory = options.taskCategory ?? "conversation";
    this.embeddingService = options.embeddingService;
    this.n8nService = options.n8nService;
    this.sandboxService = options.sandboxService;
    this.workspaceService = options.workspaceService;
    this.messagingService = options.messagingService;
    this.autonomyTierService = options.autonomyTierService;
    this.projectRegistryService = options.projectRegistryService;
    this.monitoringService = options.monitoringService;
    this.browserService = options.browserService;
    this.gmailService = options.gmailService;
    this.calendarService = options.calendarService;
    this.episodicMemoryService = options.episodicMemoryService;
    this.proceduralMemoryService = options.proceduralMemoryService;
    this.prReviewService = options.prReviewService;
    this.outboundWebhookService = options.outboundWebhookService;
    this.conversationBranchingService = options.conversationBranchingService;
    this.discordService = options.discordService;
    this.vpsCommandService = options.vpsCommandService;
    this.isAutonomous = options.isAutonomous ?? false;
  }

  /**
   * Call registry.complete with retry on transient failures (429/503).
   * Exponential backoff: 2s, 4s. Max 2 retries.
   */
  private async completeWithRetry(
    ...args: Parameters<LlmRegistry["complete"]>
  ): ReturnType<LlmRegistry["complete"]> {
    const MAX_RETRIES = 2;
    const BASE_DELAY_MS = 2000;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.registry.complete(...args);
      } catch (err: unknown) {
        const isRetryable =
          err instanceof Error &&
          (/429|rate.limit/i.test(err.message) ||
            /503|service.unavailable/i.test(err.message) ||
            /ECONNRESET|ECONNREFUSED|timeout/i.test(err.message));

        if (!isRetryable || attempt === MAX_RETRIES) {
          throw err;
        }

        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        this.logger.warn(
          { attempt: attempt + 1, delay, error: (err as Error).message },
          "LLM call failed, retrying",
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // Unreachable, but TypeScript needs it
    throw new Error("completeWithRetry: exhausted retries");
  }

  /**
   * Extract native thinking content blocks, store as traces, and return only non-thinking blocks.
   * Also parses legacy <thinking> tags from text blocks for backward compatibility.
   */
  private extractAndStoreThinking(
    contentBlocks: (LlmTextContent | LlmThinkingContent | LlmToolUseContent | LlmToolResultContent)[],
    conversationId: string,
    round: number,
  ): (LlmTextContent | LlmToolUseContent | LlmToolResultContent)[] {
    const result: (LlmTextContent | LlmToolUseContent | LlmToolResultContent)[] = [];

    for (const block of contentBlocks) {
      if (block.type === "thinking") {
        // Native thinking block from extended thinking
        if (this.db && block.thinking) {
          saveThinkingTrace(this.db, {
            conversationId,
            requestId: this.requestId,
            round,
            content: block.thinking,
          }).catch(() => {}); // fire-and-forget
        }
        continue; // Filter out thinking blocks
      }

      if (block.type === "text") {
        // Legacy: parse <thinking> tags from text content
        const thinkingRegex = /<thinking>([\s\S]*?)<\/thinking>/g;
        let match: RegExpExecArray | null;
        const thinkingBlocks: string[] = [];
        while ((match = thinkingRegex.exec(block.text)) !== null) {
          thinkingBlocks.push(match[1].trim());
        }
        if (thinkingBlocks.length > 0 && this.db) {
          for (const tb of thinkingBlocks) {
            saveThinkingTrace(this.db, {
              conversationId,
              requestId: this.requestId,
              round,
              content: tb,
            }).catch(() => {});
          }
        }
        const stripped = block.text.replace(thinkingRegex, "").trim();
        if (stripped) {
          result.push({ type: "text", text: stripped });
        }
        continue;
      }

      result.push(block);
    }

    return result;
  }

  /**
   * Filter tools by evaluating optional preconditions.
   * Also strips the preconditions property before passing to LLM API.
   */
  private async filterAvailableTools(tools: LlmTool[]): Promise<LlmTool[]> {
    const results: LlmTool[] = [];
    for (const tool of tools) {
      if (tool.preconditions) {
        try {
          const available = await tool.preconditions();
          if (!available) {
            this.logger.debug({ tool: tool.name }, "tool precondition failed, filtering out");
            continue;
          }
        } catch {
          this.logger.debug({ tool: tool.name }, "tool precondition threw, filtering out");
          continue;
        }
      }
      // Strip preconditions before sending to LLM
      const { preconditions: _p, ...cleanTool } = tool;
      results.push(cleanTool as LlmTool);
    }
    return results;
  }

  async run(
    message: string,
    conversationId?: string,
    history?: AgentMessage[],
    userId?: string,
    requestId?: string,
  ): Promise<OrchestratorResult> {
    this.requestId = requestId;
    const id = conversationId ?? crypto.randomUUID();
    this.logger.info({ conversationId: id }, "orchestrator run started");

    // Pre-load user memories for system prompt context
    let memoryContext = "";
    if (userId && this.db) {
      const userMemories = await recallMemories(this.db, userId, { limit: 10 });

      // Auto semantic retrieval: find memories relevant to the current message
      let relevantMemories: Array<{ id: string; category: string; key: string; content: string }> = [];
      if (this.embeddingService) {
        try {
          const queryEmbedding = await this.embeddingService.embed(message);
          const vectorResults = await searchMemoriesByVector(this.db, queryEmbedding, userId, 5);
          relevantMemories = vectorResults.map((m) => ({
            id: m.id,
            category: m.category,
            key: m.key,
            content: m.content,
          }));
        } catch (err) {
          this.logger.warn({ err }, "auto semantic memory retrieval failed (non-fatal)");
        }
      }

      // Merge: relevant first, then importance-based (dedupe by ID)
      const seenIds = new Set(relevantMemories.map((m) => m.id));
      const generalMemories = userMemories.filter((m) => !seenIds.has(m.id));

      const parts: string[] = [];
      if (relevantMemories.length > 0) {
        parts.push("Relevant to this conversation:");
        parts.push(...relevantMemories.map((m) => `- [${m.category}] ${sanitizeForPrompt(m.key)}: ${sanitizeForPrompt(m.content)}`));
      }
      if (generalMemories.length > 0) {
        if (parts.length > 0) parts.push("");
        parts.push("General knowledge:");
        parts.push(...generalMemories.map((m) => `- [${m.category}] ${sanitizeForPrompt(m.key)}: ${sanitizeForPrompt(m.content)}`));
      }

      // Proactive decision surfacing (SESS-02): highlight decisions separately
      if (relevantMemories.length > 0) {
        const decisionMemories = relevantMemories.filter((m) => m.category === "decisions");
        if (decisionMemories.length > 0) {
          const decisionBlock = decisionMemories
            .map((m) => `- ${sanitizeForPrompt(m.key)}: ${sanitizeForPrompt(m.content)}`)
            .join("\n");
          parts.push("");
          parts.push("Past decisions relevant to this topic (reference these naturally when applicable):");
          parts.push(decisionBlock);
        }
      }

      if (parts.length > 0) {
        memoryContext = parts.join("\n");
      }

      // Contextual awareness: inject time-of-day, recent activity, tone guidance
      try {
        const awarenessService = new ContextualAwarenessService(this.db, {
          timezone: optionalEnv("BRIEFING_TIMEZONE", "America/New_York"),
        });
        const contextBlock = await awarenessService.getContextBlock(userId);
        if (contextBlock) {
          memoryContext = contextBlock + (memoryContext ? "\n\n" + memoryContext : "");
        }
      } catch (err) {
        this.logger.warn({ err }, "contextual awareness failed (non-fatal)");
      }

      // Session continuity context (MEM-04, SESS-01)
      try {
        const sessionContextService = new SessionContextService(this.db);
        const returnBlock = await sessionContextService.getReturnContext(userId);
        if (returnBlock) {
          memoryContext = returnBlock + (memoryContext ? "\n\n" + memoryContext : "");
        } else {
          const sessionBlock = await sessionContextService.getRecentContext(userId);
          if (sessionBlock) {
            memoryContext = sessionBlock + (memoryContext ? `\n\n${memoryContext}` : "");
          }
        }
      } catch (err) {
        this.logger.warn({ err }, "session context retrieval failed (non-fatal)");
      }
    }

    // Resolve active project from conversation metadata
    let activeProjectSlug: string | undefined;
    if (this.db && conversationId) {
      try {
        const conv = await getConversation(this.db, conversationId);
        const meta = conv?.metadata as { activeProjectId?: string } | null;
        if (meta?.activeProjectId && this.projectRegistryService) {
          const proj = this.projectRegistryService.getActiveProject(meta.activeProjectId);
          activeProjectSlug = proj?.slug;
        }
      } catch { /* non-fatal */ }
    }

    // RAG retrieval: find relevant document chunks (scoped to active project if set)
    const ragContext = await this.retrieveRagContext(message, activeProjectSlug);
    if (ragContext) {
      const wrappedRag = `<user-data>\n${sanitizeForPrompt(ragContext)}\n</user-data>`;
      memoryContext = memoryContext ? `${memoryContext}\n\n${wrappedRag}` : wrappedRag;
    }

    // Tool efficacy hints
    if (this.db) {
      try {
        const efficacyService = new ToolEfficacyService(this.db);
        const hints = await efficacyService.getEfficacyHints();
        if (hints) {
          memoryContext = memoryContext ? `${memoryContext}\n\n${hints}` : hints;
        }
      } catch { /* non-fatal */ }
    }

    const systemPrompt = await buildSystemPrompt(memoryContext || undefined, this.db);

    // Build message history for context
    const messages: LlmMessage[] = [];

    const trimmed = history?.length ? this.trimHistory(history) : [];
    if (trimmed.length) {
      for (const msg of trimmed) {
        messages.push({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.content,
        });
      }
    }

    messages.push({ role: "user", content: message });

    // Build tools array: orchestrator-only tools + shared tools
    const rawTools: LlmTool[] = this.db
      ? [CREATE_PLAN_TOOL, CREATE_MILESTONE_TOOL, REQUEST_APPROVAL_TOOL, DELEGATE_TO_SUBAGENT_TOOL, DELEGATE_PARALLEL_TOOL, CHECK_SUBAGENT_TOOL]
      : [];

    rawTools.push(...buildSharedToolList({
      db: this.db,
      embeddingService: this.embeddingService,
      n8nService: this.n8nService,
      sandboxService: this.sandboxService,
      workspaceService: this.workspaceService,
      messagingService: this.messagingService,
      projectRegistryService: this.projectRegistryService,
      monitoringService: this.monitoringService,
      browserService: this.browserService,
      gmailService: this.gmailService,
      calendarService: this.calendarService,
      episodicMemoryService: this.episodicMemoryService,
      proceduralMemoryService: this.proceduralMemoryService,
      prReviewService: this.prReviewService,
    }, undefined, this.autonomyTierService));

    const tools = await this.filterAvailableTools(rawTools);
    const toolCache = new ToolCache();

    try {
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let plan: PlanResult | undefined;
      // Agentic tool-use loop
      const useThinking = this.taskCategory === "planning";
      let response = await this.completeWithRetry(this.taskCategory, {
        system: systemPrompt,
        messages,
        tools,
        max_tokens: useThinking ? 16384 : 8192,
        ...(useThinking ? { thinking: { type: "enabled" as const, budget_tokens: 10000 } } : {}),
        metadata: { agentRole: "orchestrator", conversationId: id, userId },
      });

      totalInputTokens += response.usage.inputTokens;
      totalOutputTokens += response.usage.outputTokens;
      const providerName = response.provider;

      const MAX_TOOL_ROUNDS = 10;
      let round = 0;

      while (response.stop_reason === "tool_use" && round < MAX_TOOL_ROUNDS) {
        round++;
        const toolResults: LlmToolResultContent[] = [];

        for (const block of response.content) {
          if (block.type === "tool_use") {
            this.logger.info({ tool: block.name, conversationId: id }, "executing tool");

            // Block destructive tools without explicit confirmation
            if (CONFIRMATION_REQUIRED_TOOLS.has(block.name)) {
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: sanitizeForPrompt(JSON.stringify({ blocked: true, tool: block.name, message: `Tool "${block.name}" requires user confirmation. Ask the user to confirm this action before retrying.` })),
              });
              continue;
            }

            // Check tool cache before executing
            const cached = toolCache.get(block.name, block.input as Record<string, unknown>);
            let result: unknown;
            if (cached !== undefined) {
              result = cached;
            } else {
              result = await this.executeTool(block, id, userId);
              toolCache.set(block.name, block.input as Record<string, unknown>, result);
            }

            // If create_plan returned a plan, capture it
            if (block.name === "create_plan" && result && "goalId" in (result as object)) {
              plan = result as PlanResult;
            }

            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: sanitizeForPrompt(JSON.stringify(result)),
            });
          }
        }

        // Continue the conversation with tool results
        messages.push({ role: "assistant", content: response.content });
        messages.push({ role: "user", content: toolResults });

        response = await this.completeWithRetry(this.taskCategory, {
          system: systemPrompt,
          messages,
          tools,
          max_tokens: 4096,
          metadata: { agentRole: "orchestrator", conversationId: id, userId },
        });

        totalInputTokens += response.usage.inputTokens;
        totalOutputTokens += response.usage.outputTokens;
      }

      // Extract thinking traces and filter to non-thinking content
      const finalContent = this.extractAndStoreThinking(response.content, id, round);

      // Extract final text response
      const textBlocks = finalContent
        .filter((block): block is LlmTextContent => block.type === "text")
        .map((block) => block.text);

      let responseText = textBlocks.join("\n");

      if (!responseText && plan) {
        responseText = this.buildPlanSummary(plan);
      }

      this.logger.info(
        {
          conversationId: id,
          model: response.model,
          provider: providerName,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          toolRounds: round,
          hasPlan: !!plan,
        },
        "orchestrator run completed",
      );

      // Record LLM usage for the orchestrator's own calls
      if (this.db) {
        try {
          await recordLlmUsage(this.db, {
            provider: providerName,
            model: response.model,
            taskCategory: this.taskCategory,
            agentRole: "orchestrator",
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            conversationId: id,
          });
        } catch (usageErr) {
          this.logger.warn({ err: usageErr }, "failed to record orchestrator LLM usage");
        }
      }

      return {
        conversationId: id,
        agentRole: "orchestrator",
        response: responseText,
        model: response.model,
        provider: providerName,
        usage: {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
        },
        plan,
      };
    } catch (err) {
      this.logger.error({ conversationId: id, err }, "orchestrator run failed");
      throw err;
    }
  }

  async runStream(
    message: string,
    onEvent: StreamCallback,
    conversationId?: string,
    history?: AgentMessage[],
    userId?: string,
    requestId?: string,
    signal?: AbortSignal,
  ): Promise<OrchestratorResult> {
    this.requestId = requestId;
    const id = conversationId ?? crypto.randomUUID();

    await onEvent({ type: "thinking", data: { round: 0, message: "Loading context..." } });

    // Reuse run() setup: memory loading
    let memoryContext = "";
    if (userId && this.db) {
      const userMemories = await recallMemories(this.db, userId, { limit: 10 });
      let relevantMemories: Array<{ id: string; category: string; key: string; content: string }> = [];
      if (this.embeddingService) {
        try {
          const queryEmbedding = await this.embeddingService.embed(message);
          const vectorResults = await searchMemoriesByVector(this.db, queryEmbedding, userId, 5);
          relevantMemories = vectorResults.map((m) => ({ id: m.id, category: m.category, key: m.key, content: m.content }));
        } catch { /* non-fatal */ }
      }
      const seenIds = new Set(relevantMemories.map((m) => m.id));
      const generalMemories = userMemories.filter((m) => !seenIds.has(m.id));
      const parts: string[] = [];
      if (relevantMemories.length > 0) {
        parts.push("Relevant to this conversation:");
        parts.push(...relevantMemories.map((m) => `- [${m.category}] ${sanitizeForPrompt(m.key)}: ${sanitizeForPrompt(m.content)}`));
      }
      if (generalMemories.length > 0) {
        if (parts.length > 0) parts.push("");
        parts.push("General knowledge:");
        parts.push(...generalMemories.map((m) => `- [${m.category}] ${sanitizeForPrompt(m.key)}: ${sanitizeForPrompt(m.content)}`));
      }
      if (parts.length > 0) memoryContext = parts.join("\n");

      // Contextual awareness for streaming
      try {
        const awarenessService = new ContextualAwarenessService(this.db, {
          timezone: optionalEnv("BRIEFING_TIMEZONE", "America/New_York"),
        });
        const contextBlock = await awarenessService.getContextBlock(userId);
        if (contextBlock) {
          memoryContext = contextBlock + (memoryContext ? "\n\n" + memoryContext : "");
        }
      } catch { /* non-fatal */ }

      // Session continuity for streaming
      try {
        const sessionContextService = new SessionContextService(this.db);
        const returnBlock = await sessionContextService.getReturnContext(userId);
        if (returnBlock) {
          memoryContext = returnBlock + (memoryContext ? "\n\n" + memoryContext : "");
        } else {
          const sessionBlock = await sessionContextService.getRecentContext(userId);
          if (sessionBlock) {
            memoryContext = sessionBlock + (memoryContext ? `\n\n${memoryContext}` : "");
          }
        }
      } catch { /* non-fatal */ }
    }

    // Resolve active project from conversation metadata
    let activeProjectSlugStream: string | undefined;
    if (this.db && conversationId) {
      try {
        const conv = await getConversation(this.db, conversationId);
        const meta = conv?.metadata as { activeProjectId?: string } | null;
        if (meta?.activeProjectId && this.projectRegistryService) {
          const proj = this.projectRegistryService.getActiveProject(meta.activeProjectId);
          activeProjectSlugStream = proj?.slug;
        }
      } catch { /* non-fatal */ }
    }

    // RAG retrieval: find relevant document chunks (scoped to active project if set)
    const ragContext = await this.retrieveRagContext(message, activeProjectSlugStream);
    if (ragContext) {
      const wrappedRag = `<user-data>\n${sanitizeForPrompt(ragContext)}\n</user-data>`;
      memoryContext = memoryContext ? `${memoryContext}\n\n${wrappedRag}` : wrappedRag;
    }

    // Tool efficacy hints (stream path)
    if (this.db) {
      try {
        const efficacyService = new ToolEfficacyService(this.db);
        const hints = await efficacyService.getEfficacyHints();
        if (hints) {
          memoryContext = memoryContext ? `${memoryContext}\n\n${hints}` : hints;
        }
      } catch { /* non-fatal */ }
    }

    const systemPrompt = await buildSystemPrompt(memoryContext || undefined, this.db);
    const messages: LlmMessage[] = [];
    const trimmed = history?.length ? this.trimHistory(history) : [];
    for (const msg of trimmed) {
      messages.push({ role: msg.role === "user" ? "user" : "assistant", content: msg.content });
    }
    messages.push({ role: "user", content: message });

    const rawToolsStream: LlmTool[] = this.db
      ? [CREATE_PLAN_TOOL, CREATE_MILESTONE_TOOL, REQUEST_APPROVAL_TOOL, DELEGATE_TO_SUBAGENT_TOOL, DELEGATE_PARALLEL_TOOL, CHECK_SUBAGENT_TOOL]
      : [];
    rawToolsStream.push(...buildSharedToolList({
      db: this.db,
      embeddingService: this.embeddingService,
      n8nService: this.n8nService,
      sandboxService: this.sandboxService,
      workspaceService: this.workspaceService,
      messagingService: this.messagingService,
      projectRegistryService: this.projectRegistryService,
      monitoringService: this.monitoringService,
      browserService: this.browserService,
      gmailService: this.gmailService,
      calendarService: this.calendarService,
      episodicMemoryService: this.episodicMemoryService,
      proceduralMemoryService: this.proceduralMemoryService,
    }, undefined, this.autonomyTierService));

    const tools = await this.filterAvailableTools(rawToolsStream);
    const toolCache = new ToolCache();

    try {
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let plan: PlanResult | undefined;

      await onEvent({ type: "thinking", data: { round: 1, message: "Generating response..." } });

      // Track whether the provider streamed text deltas directly (e.g. Anthropic)
      let streamedDirectly = false;
      const streamTextDelta = (text: string) => {
        streamedDirectly = true;
        onEvent({ type: "text_delta", data: { text } });
      };

      if (signal?.aborted) throw new Error("Request aborted");
      let response = await this.completeWithRetry(this.taskCategory, { system: systemPrompt, messages, tools, max_tokens: 4096, metadata: { agentRole: "orchestrator", conversationId: id }, onTextDelta: streamTextDelta });
      totalInputTokens += response.usage.inputTokens;
      totalOutputTokens += response.usage.outputTokens;
      const providerName = response.provider;

      const MAX_TOOL_ROUNDS = 10;
      let round = 0;

      while (response.stop_reason === "tool_use" && round < MAX_TOOL_ROUNDS) {
        round++;
        streamedDirectly = false; // reset for each round
        const toolResults: LlmToolResultContent[] = [];

        for (const block of response.content) {
          if (block.type === "tool_use") {
            const toolInput = block.input as Record<string, unknown>;
            await onEvent({ type: "tool_call", data: { tool: block.name, input: this.sanitizeToolInput(toolInput) } });

            // Block destructive tools without explicit confirmation
            if (CONFIRMATION_REQUIRED_TOOLS.has(block.name)) {
              const blocked = { blocked: true, tool: block.name, message: `Tool "${block.name}" requires user confirmation. Ask the user to confirm this action before retrying.` };
              await onEvent({ type: "tool_result", data: { tool: block.name, summary: `Blocked: ${block.name} requires confirmation`, needs_confirmation: true } });
              toolResults.push({ type: "tool_result", tool_use_id: block.id, content: sanitizeForPrompt(JSON.stringify(blocked)) });
              continue;
            }

            // Check tool cache before executing
            const cached = toolCache.get(block.name, toolInput);
            let result: unknown;
            if (cached !== undefined) {
              result = cached;
            } else {
              result = await this.executeTool(block, id, userId);
              toolCache.set(block.name, toolInput, result);
            }

            if (block.name === "create_plan" && result && "goalId" in (result as object)) {
              plan = result as PlanResult;
            }

            await onEvent({ type: "tool_result", data: { tool: block.name, summary: this.summarizeToolResult(block.name, result) } });
            toolResults.push({ type: "tool_result", tool_use_id: block.id, content: sanitizeForPrompt(JSON.stringify(result)) });
          }
        }

        messages.push({ role: "assistant", content: response.content });
        messages.push({ role: "user", content: toolResults });

        await onEvent({ type: "thinking", data: { round: round + 1, message: `Processing (round ${round + 1})...` } });
        if (signal?.aborted) throw new Error("Request aborted");
        response = await this.completeWithRetry(this.taskCategory, { system: systemPrompt, messages, tools, max_tokens: 4096, metadata: { agentRole: "orchestrator", conversationId: id }, onTextDelta: streamTextDelta });
        totalInputTokens += response.usage.inputTokens;
        totalOutputTokens += response.usage.outputTokens;
      }

      // Extract thinking traces and filter to non-thinking content
      const finalContent = this.extractAndStoreThinking(response.content, id, round);
      const textBlocks = finalContent.filter((b): b is LlmTextContent => b.type === "text").map((b) => b.text);
      let responseText = textBlocks.join("\n");

      if (!responseText && plan) responseText = this.buildPlanSummary(plan);

      // If the provider didn't stream text deltas directly, emit chunks for progressive rendering
      if (!streamedDirectly) {
        const CHUNK_SIZE = 100;
        for (let i = 0; i < responseText.length; i += CHUNK_SIZE) {
          await onEvent({ type: "text_delta", data: { text: responseText.slice(i, i + CHUNK_SIZE) } });
        }
      }
      await onEvent({ type: "done", data: { response: responseText, model: response.model, provider: providerName, usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens } } });

      // Record LLM usage for the orchestrator's streaming calls
      if (this.db) {
        try {
          await recordLlmUsage(this.db, {
            provider: providerName,
            model: response.model,
            taskCategory: this.taskCategory,
            agentRole: "orchestrator",
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            conversationId: id,
          });
        } catch (usageErr) {
          this.logger.warn({ err: usageErr }, "failed to record orchestrator LLM usage");
        }
      }

      return { conversationId: id, agentRole: "orchestrator", response: responseText, model: response.model, provider: providerName, usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens }, plan };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await onEvent({ type: "error", data: { error: errorMsg } });
      throw err;
    }
  }

  private sanitizeToolInput(input: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (typeof value === "string" && value.length > 200) {
        sanitized[key] = value.slice(0, 200) + "...";
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  private summarizeToolResult(toolName: string, result: unknown): string {
    if (!result || typeof result !== "object") return "completed";
    const r = result as Record<string, unknown>;
    if (r.error) return `error: ${String(r.error).slice(0, 100)}`;
    switch (toolName) {
      case "create_plan": return `Plan created: ${r.goalTitle ?? ""}`;
      case "search_web": return `Found results`;
      case "save_memory": return `Saved: ${r.key ?? ""}`;
      case "recall_memories": {
        if (Array.isArray(result)) return `Recalled ${result.length} memories`;
        const rm = result as Record<string, unknown>;
        const memCount = Array.isArray(rm.memories) ? rm.memories.length : 0;
        const hasRag = Boolean(rm.ragContext);
        return `Recalled ${memCount} memories${hasRag ? " + RAG context" : ""}`;
      }
      case "execute_code": return `Exit code: ${r.exitCode ?? "?"}`;
      case "read_file": return `Read: ${r.path ?? ""}`;
      case "write_file": return `Wrote: ${r.path ?? ""}`;
      default: return "completed";
    }
  }

  private async executeTool(
    block: LlmToolUseContent,
    conversationId: string,
    userId?: string,
  ): Promise<unknown> {
    const startTime = Date.now();
    let success = true;
    try {
      const result = await this.executeToolInner(block, conversationId, userId);
      if (result && typeof result === "object" && "error" in (result as Record<string, unknown>)) {
        success = false;
      }
      return result;
    } catch (err) {
      success = false;
      throw err;
    } finally {
      const durationMs = Date.now() - startTime;
      recordToolMetrics({ toolName: block.name, durationMs, success });
      if (this.db) {
        recordToolExecution(this.db, {
          toolName: block.name,
          durationMs,
          success,
          errorMessage: success ? undefined : "tool returned error",
          requestId: this.requestId,
        }).catch((err) => {
          this.logger.warn({ err, tool: block.name }, "failed to persist tool execution (non-fatal)");
        });
        recordActionSafe(this.db, {
          userId,
          actionType: "tool_executed",
          actionDetail: block.name,
          metadata: { durationMs, success },
        });
      }
      if (durationMs > 5000) {
        this.logger.warn({ tool: block.name, durationMs }, "slow tool execution");
      }
    }
  }

  private async executeToolInner(
    block: LlmToolUseContent,
    conversationId: string,
    userId?: string,
  ): Promise<unknown> {
    // Orchestrator-only tools handled here
    switch (block.name) {
      case "create_plan": {
        if (!this.db) return { error: "Database not available" };
        return this.persistPlan(conversationId, block.input as unknown as CreatePlanInput, userId);
      }
      case "create_milestone": {
        if (!this.db) return { error: "Database not available" };
        const input = block.input as {
          title: string;
          description: string;
          order_index?: number;
          due_date?: string;
        };
        const milestone = await createMilestone(this.db, {
          conversationId,
          title: input.title,
          description: input.description,
          orderIndex: input.order_index ?? 0,
          dueDate: input.due_date ? new Date(input.due_date) : undefined,
          createdBy: userId,
        });
        this.logger.info({ milestoneId: milestone.id }, "milestone created");
        return {
          milestoneId: milestone.id,
          title: milestone.title,
          message: `Milestone created. Use create_plan with milestone_id="${milestone.id}" to add goals to it.`,
        };
      }
      case "request_approval": {
        if (!this.db) return { error: "Database not available" };
        const input = block.input as { task_id: string; reason: string };
        const approval = await createApproval(this.db, {
          taskId: input.task_id,
          requestedBy: "orchestrator",
          reason: input.reason,
        });
        this.logger.info({ approvalId: approval.id, taskId: input.task_id }, "approval requested");
        notifyApprovalCreated({
          approvalId: approval.id,
          taskId: input.task_id,
          reason: input.reason,
          requestedBy: "orchestrator",
        }).catch(() => {});
        return {
          approvalId: approval.id,
          status: "pending",
          message: `Approval requested. The user can approve with /approve ${approval.id}`,
        };
      }

      // ── Subagent delegation tools ──

      case "delegate_to_subagent": {
        if (!this.db) return { error: "Database not available" };
        const input = block.input as { title: string; instruction: string; wait_for_result?: boolean };
        const run = await createSubagentRun(this.db, {
          parentRequestId: this.requestId,
          conversationId,
          title: input.title,
          instruction: input.instruction,
          userId,
        });
        await enqueueSubagentTask({
          subagentRunId: run.id,
          title: input.title,
          instruction: input.instruction,
          conversationId,
          userId,
          parentRequestId: this.requestId,
        });
        this.logger.info({ subagentRunId: run.id, title: input.title }, "subagent delegated");

        if (input.wait_for_result) {
          // Poll for completion (up to 5 min)
          const deadline = Date.now() + 300_000;
          while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 3000));
            const status = await getSubagentRun(this.db, run.id);
            if (status?.status === "completed") {
              return { subagentRunId: run.id, status: "completed", output: status.output };
            }
            if (status?.status === "failed") {
              return { subagentRunId: run.id, status: "failed", error: status.error };
            }
          }
          return { subagentRunId: run.id, status: "timeout", message: "Subagent still running after 5 minutes. Use check_subagent to poll later." };
        }

        return { subagentRunId: run.id, status: "queued", message: "Subagent spawned. Use check_subagent to poll for results." };
      }

      case "delegate_parallel": {
        if (!this.db) return { error: "Database not available" };
        const input = block.input as { tasks: Array<{ title: string; instruction: string }> };
        const results = [];
        for (const task of input.tasks.slice(0, 5)) {
          const run = await createSubagentRun(this.db, {
            parentRequestId: this.requestId,
            conversationId,
            title: task.title,
            instruction: task.instruction,
            userId,
          });
          await enqueueSubagentTask({
            subagentRunId: run.id,
            title: task.title,
            instruction: task.instruction,
            conversationId,
            userId,
            parentRequestId: this.requestId,
          });
          results.push({ subagentRunId: run.id, title: task.title, status: "queued" });
        }
        this.logger.info({ count: results.length }, "parallel subagents delegated");
        return { subagents: results, message: "Use check_subagent to poll each subagent for results." };
      }

      case "check_subagent": {
        if (!this.db) return { error: "Database not available" };
        const input = block.input as { subagent_run_id: string };
        const run = await getSubagentRun(this.db, input.subagent_run_id);
        if (!run) return { error: "Subagent run not found" };
        return {
          subagentRunId: run.id,
          title: run.title,
          status: run.status,
          output: run.output,
          error: run.error,
          toolRounds: run.toolRounds,
          toolsUsed: run.toolsUsed,
          tokens: run.tokens,
          durationMs: run.durationMs,
        };
      }

      default: {
        // Delegate to shared tool executor with tier enforcement
        const result = await executeWithTierCheck(block, {
          db: this.db,
          embeddingService: this.embeddingService,
          n8nService: this.n8nService,
          sandboxService: this.sandboxService,
          workspaceService: this.workspaceService,
          messagingService: this.messagingService,
          autonomyTierService: this.autonomyTierService,
          projectRegistryService: this.projectRegistryService,
          monitoringService: this.monitoringService,
          browserService: this.browserService,
          gmailService: this.gmailService,
          calendarService: this.calendarService,
          episodicMemoryService: this.episodicMemoryService,
          proceduralMemoryService: this.proceduralMemoryService,
          outboundWebhookService: this.outboundWebhookService,
          conversationBranchingService: this.conversationBranchingService,
          discordService: this.discordService,
          vpsCommandService: this.vpsCommandService,
        }, { conversationId, userId, agentRole: "orchestrator", isAutonomous: this.isAutonomous } as ToolExecutorContext);

        if (result === null) return { error: `Unknown tool: ${block.name}` };
        return result;
      }
    }
  }

  private async retrieveRagContext(query: string, sourceId?: string): Promise<string | null> {
    if (!this.db || !this.embeddingService) return null;
    try {
      const chunks = await retrieve(this.db, this.embeddingService.embed.bind(this.embeddingService), query, {
        limit: 5,
        minScore: 0.3,
        diversifySources: true,
        llmRegistry: this.registry,
        enableReranking: true,
        ...(sourceId ? { sourceId } : {}),
      });
      if (chunks.length === 0) return null;
      return formatContext(chunks);
    } catch (err) {
      this.logger.warn({ err }, "RAG retrieval failed (non-fatal)");
      return null;
    }
  }

  private trimHistory(history: AgentMessage[], maxTokenEstimate = 80_000): AgentMessage[] {
    let tokenCount = 0;
    const trimmed: AgentMessage[] = [];
    for (let i = history.length - 1; i >= 0; i--) {
      const est = Math.ceil(history[i].content.length / 4);
      if (tokenCount + est > maxTokenEstimate) break;
      tokenCount += est;
      trimmed.unshift(history[i]);
    }
    return trimmed;
  }

  private async persistPlan(conversationId: string, input: CreatePlanInput, userId?: string): Promise<PlanResult> {
    const db = this.db!;

    // Validate dependency graph before creating anything (cycle detection)
    const hasDeps = input.tasks.some((t) => t.depends_on && t.depends_on.length > 0);
    if (hasDeps) {
      validateDependencyGraph(input.tasks);
    }

    // Classify scope — server-side keyword analysis merged with optional LLM hint
    const scope = classifyGoalScope(input.tasks, input.scope);
    const requiresApproval = scopeRequiresApproval(scope);


    const goal = await createGoal(db, {
      conversationId,
      title: input.goal_title,
      description: input.goal_description,
      priority: input.goal_priority,
      createdBy: userId,
      milestoneId: input.milestone_id || undefined,
      scope,
      requiresApproval,
    });

    // If approval required → "proposed"; otherwise → "active"
    const initialStatus = requiresApproval ? "proposed" : "active";
    await updateGoalStatus(db, goal.id, initialStatus);

    // Pass 1: create all tasks to get UUIDs
    const createdTasks: PlanResult["tasks"] = [];

    // Pass 1: create all tasks (without dependencies)
    for (let i = 0; i < input.tasks.length; i++) {
      const t = input.tasks[i];
      const task = await createTask(db, {
        goalId: goal.id,
        title: t.title,
        description: t.description,
        assignedAgent: t.assigned_agent,
        orderIndex: i,
        parallelGroup: t.parallel_group,
        input: t.description,
      });

      createdTasks.push({
        id: task.id,
        title: task.title,
        assignedAgent: task.assignedAgent as AgentRole,
        orderIndex: task.orderIndex,
        parallelGroup: task.parallelGroup,
      });
    }

    // Pass 2: resolve index-based depends_on to UUIDs and update tasks
    if (hasDeps) {
      for (let i = 0; i < input.tasks.length; i++) {
        const depIndices = input.tasks[i].depends_on;
        if (depIndices && depIndices.length > 0) {
          const depUuids = depIndices
            .filter((idx) => idx >= 0 && idx < createdTasks.length)
            .map((idx) => createdTasks[idx].id);
          if (depUuids.length > 0) {
            await updateTaskDependencies(db, createdTasks[i].id, depUuids);
            createdTasks[i].dependsOn = depUuids;
          }
        }
      }
    }

    // Fire-and-forget notification for proposed goals
    if (requiresApproval) {
      notifyGoalProposed({
        goalId: goal.id,
        goalTitle: goal.title,
        scope,
        taskCount: createdTasks.length,
      }).catch((err) => this.logger.warn({ err }, "Failed to notify goal proposed"));
    }


    return {
      goalId: goal.id,
      goalTitle: goal.title,
      scope,
      requiresApproval,
      tasks: createdTasks,
    };
  }

  private buildPlanSummary(plan: PlanResult): string {
    const taskLines = plan.tasks
      .map((t, i) => `${i + 1}. ${t.title} (${t.assignedAgent})`)
      .join("\n");

    let summary = `Plan created: ${plan.goalTitle}\n\nTasks:\n${taskLines}`;

    if (plan.requiresApproval) {
      summary += `\n\n⚠️ This plan has **${plan.scope}** scope and requires human approval before execution. Status: proposed.`;
    }

    return summary;
  }
}
