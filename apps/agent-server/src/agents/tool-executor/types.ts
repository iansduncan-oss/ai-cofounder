import type { Db } from "@ai-cofounder/db";
import type { EmbeddingService } from "@ai-cofounder/llm";
import type { SandboxService } from "@ai-cofounder/sandbox";
import type { N8nService } from "../../services/n8n.js";
import type { WorkspaceService } from "../../services/workspace.js";
import type { AgentMessagingService } from "../../services/agent-messaging.js";
import type { AutonomyTierService } from "../../services/autonomy-tier.js";
import type { ProjectRegistryService } from "../../services/project-registry.js";
import type { MonitoringService } from "../../services/monitoring.js";
import type { BrowserService } from "../../services/browser.js";
import type { GmailService } from "../../services/gmail.js";
import type { CalendarService } from "../../services/calendar.js";
import type { EpisodicMemoryService } from "../../services/episodic-memory.js";
import type { ProceduralMemoryService } from "../../services/procedural-memory.js";
import type { PrReviewService } from "../../services/pr-review.js";
import type { OutboundWebhookService } from "../../services/outbound-webhooks.js";
import type { ConversationBranchingService } from "../../services/conversation-branching.js";
import type { DiscordService } from "../../services/discord.js";
import type { VpsCommandService } from "../../services/vps-command.js";

export interface ToolExecutorServices {
  db?: Db;
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
}

export interface ToolExecutorContext {
  conversationId: string;
  userId?: string;
  agentRole?: string;
  agentRunId?: string;
  goalId?: string;
  isAutonomous?: boolean;
  workspaceId?: string;
}
