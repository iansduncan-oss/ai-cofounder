import type { LlmToolUseContent } from "@ai-cofounder/llm";
import {
  createRegisteredProject,
  getRegisteredProjectByName,
  updateConversationMetadata,
  listProjectDependencies,
  getRegisteredProjectById,
  getChunkCount,
  listIngestionStates,
} from "@ai-cofounder/db";
import { retrieve } from "@ai-cofounder/rag";
import { createLogger } from "@ai-cofounder/shared";
import { GmailService } from "../../../services/gmail.js";
import { CalendarService } from "../../../services/calendar.js";
import type { ToolExecutorServices, ToolExecutorContext } from "../types.js";

const logger = createLogger("tool-executor:integrations");

const HANDLED = new Set([
  "send_message",
  "check_messages",
  "broadcast_update",
  "register_project",
  "switch_project",
  "list_projects",
  "analyze_cross_project_impact",
  "query_vps",
  "list_emails",
  "read_email",
  "search_emails",
  "draft_reply",
  "send_email",
  "list_calendar_events",
  "get_calendar_event",
  "search_calendar_events",
  "get_free_busy",
  "create_calendar_event",
  "update_calendar_event",
  "delete_calendar_event",
  "respond_to_calendar_event",
  "search_knowledge",
  "ingest_document",
  "knowledge_status",
  "register_webhook",
  "list_webhooks",
  "branch_conversation",
  "read_discord_messages",
  "list_discord_channels",
]);

export function handlesIntegrationTool(name: string): boolean {
  return HANDLED.has(name);
}

export async function executeIntegrationTool(
  block: LlmToolUseContent,
  services: ToolExecutorServices,
  context: ToolExecutorContext,
): Promise<unknown> {
  const { db, messagingService, projectRegistryService, monitoringService } = services;

  switch (block.name) {
    /* ── Agent messaging ── */

    case "send_message": {
      if (!messagingService) return { error: "Messaging not available" };
      const input = block.input as {
        target_role: string;
        message_type: "request" | "response" | "notification" | "handoff";
        subject: string;
        body: string;
        in_reply_to?: string;
        correlation_id?: string;
        priority?: "low" | "medium" | "high" | "critical";
      };
      const result = await messagingService.send({
        senderRole: context.agentRole ?? "orchestrator",
        senderRunId: context.agentRunId,
        targetRole: input.target_role,
        messageType: input.message_type,
        subject: input.subject,
        body: input.body,
        inReplyTo: input.in_reply_to,
        correlationId: input.correlation_id,
        priority: input.priority,
        goalId: context.goalId,
        conversationId: context.conversationId,
        metadata: { messageDepth: 0 },
      });
      return {
        sent: true,
        messageId: result.messageId,
        correlationId: result.correlationId,
        message: result.correlationId
          ? `Message sent. Use check_messages with correlation_id="${result.correlationId}" to check for a response.`
          : "Message sent.",
      };
    }

    case "check_messages": {
      if (!messagingService) return { error: "Messaging not available" };
      const input = block.input as {
        correlation_id?: string;
        sender_role?: string;
        message_type?: string;
        channel?: string;
        unread_only?: boolean;
      };

      if (input.channel) {
        const messages = await messagingService.checkBroadcast(input.channel, {
          goalId: context.goalId,
        });
        return {
          channel: input.channel,
          count: messages.length,
          messages: messages.map((m) => ({
            id: m.id,
            senderRole: m.senderRole,
            subject: m.subject,
            body: m.body,
            createdAt: m.createdAt,
          })),
        };
      }

      const messages = await messagingService.checkInbox({
        targetRole: context.agentRole ?? "orchestrator",
        targetRunId: context.agentRunId,
        correlationId: input.correlation_id,
        senderRole: input.sender_role,
        messageType: input.message_type,
        unreadOnly: input.unread_only,
      });

      return {
        count: messages.length,
        messages: messages.map((m) => ({
          id: m.id,
          senderRole: m.senderRole,
          targetRole: m.targetRole,
          messageType: m.messageType,
          subject: m.subject,
          body: m.body,
          correlationId: m.correlationId,
          inReplyTo: m.inReplyTo,
          createdAt: m.createdAt,
        })),
      };
    }

    case "broadcast_update": {
      if (!messagingService) return { error: "Messaging not available" };
      const input = block.input as { channel: string; subject: string; body: string };
      const result = await messagingService.broadcast({
        senderRole: context.agentRole ?? "orchestrator",
        senderRunId: context.agentRunId,
        channel: input.channel,
        subject: input.subject,
        body: input.body,
        goalId: context.goalId,
        conversationId: context.conversationId,
      });
      return { broadcast: true, messageId: result.messageId, channel: input.channel };
    }

    /* ── Project registry ── */

    case "register_project": {
      if (!projectRegistryService || !db) return { error: "Project registry not available" };
      const input = block.input as {
        name: string;
        workspace_path: string;
        repo_url?: string;
        description?: string;
        language?: "typescript" | "python" | "javascript" | "go" | "other";
        test_command?: string;
        default_branch?: string;
      };

      if (!projectRegistryService.validateProjectPath(input.workspace_path)) {
        return {
          error: `Path "${input.workspace_path}" is outside allowed base directories. Configure PROJECTS_BASE_DIR to allow this path.`,
        };
      }

      const slug = input.name
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");
      const project = await createRegisteredProject(db, {
        name: input.name,
        slug,
        workspacePath: input.workspace_path,
        repoUrl: input.repo_url,
        description: input.description,
        language: input.language ?? "typescript",
        defaultBranch: input.default_branch ?? "main",
        testCommand: input.test_command,
      });

      try {
        await projectRegistryService.registerProject({
          id: project.id,
          name: project.name,
          slug: project.slug,
          workspacePath: project.workspacePath,
          repoUrl: project.repoUrl,
          description: project.description,
          language: project.language ?? "typescript",
          defaultBranch: project.defaultBranch ?? "main",
          testCommand: project.testCommand,
          config: project.config as Record<string, unknown> | null,
        });
      } catch (err) {
        logger.warn(
          { err, projectId: project.id },
          "failed to register project workspace (non-fatal)",
        );
      }

      try {
        const { enqueueRagIngestion } = await import("@ai-cofounder/queue");
        enqueueRagIngestion({ action: "ingest_repo", sourceId: slug }).catch((err) =>
          logger.warn({ err }, "RAG ingestion enqueue failed"),
        );
      } catch {
        /* non-fatal */
      }

      return {
        projectId: project.id,
        name: project.name,
        slug,
        message: `Project "${project.name}" registered successfully. Use switch_project to make it active.`,
      };
    }

    case "switch_project": {
      if (!projectRegistryService || !db) return { error: "Project registry not available" };
      const input = block.input as { project_name: string };

      const project = await getRegisteredProjectByName(db, input.project_name);
      if (!project) {
        const available = projectRegistryService.listProjects().map((p) => p.name);
        return {
          error: `Project "${input.project_name}" not found. Available projects: ${available.join(", ") || "none registered yet"}`,
        };
      }

      await updateConversationMetadata(db, context.conversationId, {
        activeProjectId: project.id,
      });
      return {
        switched: true,
        projectId: project.id,
        name: project.name,
        slug: project.slug,
        message: `Switched to project "${project.name}". RAG retrieval and workspace operations are now scoped to this project.`,
      };
    }

    case "list_projects": {
      if (!projectRegistryService) return { error: "Project registry not available" };
      const projects = projectRegistryService.listProjects();
      return {
        count: projects.length,
        projects: projects.map((p) => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          language: p.language,
          workspacePath: p.workspacePath,
          description: p.description,
          defaultBranch: p.defaultBranch,
        })),
      };
    }

    case "analyze_cross_project_impact": {
      if (!projectRegistryService || !db) return { error: "Project registry not available" };
      const input = block.input as { project_name: string; change_description: string };

      const project = await getRegisteredProjectByName(db, input.project_name);
      if (!project) {
        return { error: `Project "${input.project_name}" not found` };
      }

      const deps = await listProjectDependencies(db, project.id);
      const dependencyDetails = await Promise.all(
        deps.map(async (dep) => {
          const targetId =
            dep.sourceProjectId === project.id ? dep.targetProjectId : dep.sourceProjectId;
          const direction = dep.sourceProjectId === project.id ? "depends_on" : "depended_on_by";
          const targetProject = await getRegisteredProjectById(db, targetId);
          return {
            targetProjectId: targetId,
            targetProjectName: targetProject?.name ?? "unknown",
            direction,
            dependencyType: dep.dependencyType,
            description: dep.description,
          };
        }),
      );

      return {
        project: {
          id: project.id,
          name: project.name,
          slug: project.slug,
          description: project.description,
        },
        change_description: input.change_description,
        dependency_count: deps.length,
        dependencies: dependencyDetails,
        analysis_note: "Review all 'depended_on_by' projects to assess impact of your change.",
      };
    }

    case "query_vps": {
      if (!monitoringService) return { error: "Monitoring service not available" };
      const health = await monitoringService.checkVPSHealth();
      if (!health) return { error: "VPS is not configured or health check failed" };
      return health;
    }

    /* ── Gmail ── */

    case "list_emails": {
      if (!db || !context.userId) return { error: "Gmail not connected — no authenticated user" };
      const gmail = services.gmailService ?? new GmailService(db, context.userId);
      const { maxResults } = block.input as { maxResults?: number };
      const emails = await gmail.listInbox(Math.min(maxResults ?? 10, 20));
      return { emails, count: emails.length };
    }

    case "read_email": {
      if (!db || !context.userId) return { error: "Gmail not connected — no authenticated user" };
      const gmail = services.gmailService ?? new GmailService(db, context.userId);
      const { messageId } = block.input as { messageId: string };
      if (!messageId) return { error: "messageId is required" };
      return gmail.getMessage(messageId);
    }

    case "search_emails": {
      if (!db || !context.userId) return { error: "Gmail not connected — no authenticated user" };
      const gmail = services.gmailService ?? new GmailService(db, context.userId);
      const { query, maxResults } = block.input as { query: string; maxResults?: number };
      if (!query) return { error: "query is required" };
      const emails = await gmail.searchEmails(query, Math.min(maxResults ?? 10, 20));
      return { emails, count: emails.length };
    }

    case "draft_reply": {
      if (!db || !context.userId) return { error: "Gmail not connected — no authenticated user" };
      const gmail = services.gmailService ?? new GmailService(db, context.userId);
      const input = block.input as {
        to: string;
        subject: string;
        body: string;
        cc?: string;
        threadId?: string;
        inReplyTo?: string;
      };
      if (!input.to || !input.subject || !input.body)
        return { error: "to, subject, and body are required" };
      const draft = await gmail.createDraft(input);
      return { success: true, draftId: draft.id };
    }

    case "send_email": {
      if (!db || !context.userId) return { error: "Gmail not connected — no authenticated user" };
      const gmail = services.gmailService ?? new GmailService(db, context.userId);
      const input = block.input as {
        to: string;
        subject: string;
        body: string;
        cc?: string;
        threadId?: string;
      };
      if (!input.to || !input.subject || !input.body)
        return { error: "to, subject, and body are required" };
      const sent = await gmail.sendEmail(input);
      return { success: true, messageId: sent.id, threadId: sent.threadId };
    }

    /* ── Calendar ── */

    case "list_calendar_events": {
      if (!db || !context.userId)
        return { error: "Calendar not connected — no authenticated user" };
      const cal = services.calendarService ?? new CalendarService(db, context.userId);
      const { timeMin, timeMax, maxResults } = block.input as {
        timeMin?: string;
        timeMax?: string;
        maxResults?: number;
      };
      const events = await cal.listEvents({
        timeMin,
        timeMax,
        maxResults: maxResults ? Math.min(maxResults, 50) : undefined,
      });
      return { events, count: events.length };
    }

    case "get_calendar_event": {
      if (!db || !context.userId)
        return { error: "Calendar not connected — no authenticated user" };
      const cal = services.calendarService ?? new CalendarService(db, context.userId);
      const { eventId } = block.input as { eventId: string };
      if (!eventId) return { error: "eventId is required" };
      return cal.getEvent(eventId);
    }

    case "search_calendar_events": {
      if (!db || !context.userId)
        return { error: "Calendar not connected — no authenticated user" };
      const cal = services.calendarService ?? new CalendarService(db, context.userId);
      const { query, maxResults } = block.input as { query: string; maxResults?: number };
      if (!query) return { error: "query is required" };
      const events = await cal.searchEvents(query, Math.min(maxResults ?? 10, 50));
      return { events, count: events.length };
    }

    case "get_free_busy": {
      if (!db || !context.userId)
        return { error: "Calendar not connected — no authenticated user" };
      const cal = services.calendarService ?? new CalendarService(db, context.userId);
      const { timeMin, timeMax } = block.input as { timeMin: string; timeMax: string };
      if (!timeMin || !timeMax) return { error: "timeMin and timeMax are required" };
      return cal.getFreeBusy(timeMin, timeMax);
    }

    case "create_calendar_event": {
      if (!db || !context.userId)
        return { error: "Calendar not connected — no authenticated user" };
      const cal = services.calendarService ?? new CalendarService(db, context.userId);
      const input = block.input as {
        summary: string;
        start: string;
        end: string;
        description?: string;
        location?: string;
        attendees?: string[];
        timeZone?: string;
      };
      if (!input.summary || !input.start || !input.end)
        return { error: "summary, start, and end are required" };
      const event = await cal.createEvent(input);
      return {
        success: true,
        eventId: event.id,
        summary: event.summary,
        htmlLink: event.htmlLink,
      };
    }

    case "update_calendar_event": {
      if (!db || !context.userId)
        return { error: "Calendar not connected — no authenticated user" };
      const cal = services.calendarService ?? new CalendarService(db, context.userId);
      const { eventId, ...updates } = block.input as {
        eventId: string;
        summary?: string;
        start?: string;
        end?: string;
        description?: string;
        location?: string;
        attendees?: string[];
        timeZone?: string;
      };
      if (!eventId) return { error: "eventId is required" };
      const event = await cal.updateEvent(eventId, updates);
      return { success: true, eventId: event.id, summary: event.summary };
    }

    case "delete_calendar_event": {
      if (!db || !context.userId)
        return { error: "Calendar not connected — no authenticated user" };
      const cal = services.calendarService ?? new CalendarService(db, context.userId);
      const { eventId } = block.input as { eventId: string };
      if (!eventId) return { error: "eventId is required" };
      await cal.deleteEvent(eventId);
      return { success: true, eventId };
    }

    case "respond_to_calendar_event": {
      if (!db || !context.userId)
        return { error: "Calendar not connected — no authenticated user" };
      const cal = services.calendarService ?? new CalendarService(db, context.userId);
      const { eventId, responseStatus } = block.input as {
        eventId: string;
        responseStatus: "accepted" | "declined" | "tentative";
      };
      if (!eventId || !responseStatus) return { error: "eventId and responseStatus are required" };
      const event = await cal.respondToEvent(eventId, responseStatus);
      return { success: true, eventId: event.id, responseStatus };
    }

    /* ── Knowledge base ── */

    case "search_knowledge": {
      if (!services.db || !services.embeddingService)
        return { error: "Knowledge base not available" };
      const {
        query,
        limit: kLimit,
        source_type,
      } = block.input as {
        query: string;
        limit?: number;
        source_type?: string;
      };
      const chunks = await retrieve(
        services.db,
        services.embeddingService.embed.bind(services.embeddingService),
        query,
        {
          limit: kLimit ?? 5,
          sourceType: source_type as
            | "git"
            | "conversation"
            | "slack"
            | "memory"
            | "reflection"
            | "markdown"
            | undefined,
        },
      );
      if (chunks.length === 0) return { results: [], message: "No matching documents found." };
      return {
        results: chunks.map((c) => ({
          content: c.content.slice(0, 500),
          source_type: c.sourceType,
          source_id: c.sourceId,
          score: c.score,
        })),
        count: chunks.length,
      };
    }

    case "ingest_document": {
      if (!services.db || !services.embeddingService)
        return { error: "Knowledge base not available" };
      const { content, source_id, source_type } = block.input as {
        content: string;
        source_id: string;
        source_type?: string;
      };
      const { ingestText } = await import("@ai-cofounder/rag");
      const result = await ingestText(
        services.db,
        services.embeddingService.embed.bind(services.embeddingService),
        (source_type ?? "markdown") as
          | "git"
          | "conversation"
          | "slack"
          | "memory"
          | "reflection"
          | "markdown",
        source_id,
        content,
      );
      return { ingested: true, source_id, chunks_created: result.chunksCreated };
    }

    case "knowledge_status": {
      if (!services.db) return { error: "Database not available" };
      const [chunkCount, ingestions] = await Promise.all([
        getChunkCount(services.db),
        listIngestionStates(services.db),
      ]);
      return {
        total_chunks: chunkCount,
        ingestions: ingestions.map((i) => ({
          source_type: i.sourceType,
          source_id: i.sourceId,
          chunk_count: i.chunkCount,
          last_ingested: i.lastIngestedAt,
        })),
        ingestion_count: ingestions.length,
      };
    }

    /* ── Webhooks ── */

    case "register_webhook": {
      if (!services.outboundWebhookService) return { error: "Webhook service not available" };
      const { url, event_types, description, headers } = block.input as {
        url: string;
        event_types: string[];
        description?: string;
        headers?: Record<string, string>;
      };
      const webhook = await services.outboundWebhookService.register(
        url,
        event_types,
        headers,
        description,
      );
      return { registered: true, id: webhook.id, url, event_types };
    }

    case "list_webhooks": {
      if (!services.outboundWebhookService) return { error: "Webhook service not available" };
      const webhooks = await services.outboundWebhookService.list();
      return {
        webhooks: webhooks.map((w) => ({
          id: w.id,
          url: w.url,
          event_types: w.eventTypes,
          description: w.description,
        })),
        count: webhooks.length,
      };
    }

    /* ── Conversation branching ── */

    case "branch_conversation": {
      if (!services.conversationBranchingService) return { error: "Branching not available" };
      const { branch_point_message_id } = block.input as { branch_point_message_id?: string };
      if (!context.userId) return { error: "User ID required for branching" };
      const result = await services.conversationBranchingService.branch(
        context.conversationId,
        context.userId,
        branch_point_message_id,
      );
      return {
        branched: true,
        new_conversation_id: result.id,
        messages_copied: result.messagesCopied,
      };
    }

    /* ── Discord ── */

    case "read_discord_messages": {
      if (!services.discordService) return { error: "Discord integration not available" };
      const { channel_id, limit } = block.input as { channel_id: string; limit?: number };
      const messages = await services.discordService.fetchMessages(channel_id, { limit });
      return { channel_id, count: messages.length, messages };
    }

    case "list_discord_channels": {
      if (!services.discordService) return { error: "Discord integration not available" };
      const { guild_id } = block.input as { guild_id?: string };
      const channels = await services.discordService.fetchChannels(guild_id);
      return { count: channels.length, channels };
    }

    default:
      return { error: `Integration handler got unexpected tool: ${block.name}` };
  }
}
