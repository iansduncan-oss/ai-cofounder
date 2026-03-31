import type { FastifyPluginAsync } from "fastify";
import crypto from "node:crypto";
import { createEvent } from "@ai-cofounder/db";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import { processEvent } from "../events.js";

const logger = createLogger("github-webhook");

/** Event types that trigger autonomous processing sessions */
const ACTIONABLE_EVENTS = new Set([
  "pr_opened",
  "pr_closed",
  "issue_opened",
  "workflow_failure",
]);

/** Returns true if this event should trigger an autonomous session */
function isActionableEvent(type: string): boolean {
  return ACTIONABLE_EVENTS.has(type);
}

/** Verify GitHub webhook HMAC-SHA256 signature */
function verifyGitHubSignature(payload: string, signature: string, secret: string): boolean {
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Extract a concise summary from common GitHub event types */
function summarizeGitHubEvent(
  eventType: string,
  payload: Record<string, unknown>,
): { type: string; summary: string } {
  const action = payload.action as string | undefined;
  const repo = (payload.repository as Record<string, unknown>)?.full_name ?? "unknown";

  switch (eventType) {
    case "push": {
      const commits = (payload.commits as unknown[]) ?? [];
      const branch = (payload.ref as string)?.replace("refs/heads/", "") ?? "unknown";
      return { type: "push", summary: `${commits.length} commit(s) pushed to ${repo}/${branch}` };
    }
    case "pull_request": {
      const pr = payload.pull_request as Record<string, unknown>;
      const title = pr?.title ?? "untitled";
      return { type: `pr_${action}`, summary: `PR ${action}: "${title}" on ${repo}` };
    }
    case "issues": {
      const issue = payload.issue as Record<string, unknown>;
      const title = issue?.title ?? "untitled";
      return { type: `issue_${action}`, summary: `Issue ${action}: "${title}" on ${repo}` };
    }
    case "issue_comment": {
      const comment = payload.comment as Record<string, unknown>;
      const body = ((comment?.body as string) ?? "").slice(0, 100);
      return { type: `comment_${action}`, summary: `Comment ${action} on ${repo}: "${body}"` };
    }
    case "workflow_run": {
      const run = payload.workflow_run as Record<string, unknown>;
      const name = run?.name ?? "unknown";
      const conclusion = run?.conclusion ?? "unknown";
      // Map conclusions to actionable types: only "failure" triggers processing
      const type = conclusion === "failure" ? "workflow_failure" : `workflow_${conclusion}`;
      return {
        type,
        summary: `Workflow "${name}" ${conclusion} on ${repo}`,
      };
    }
    default:
      return { type: eventType, summary: `GitHub ${eventType} event on ${repo}` };
  }
}

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  /** POST /github — receive GitHub webhook events */
  app.post(
    "/github",
    {
      schema: { tags: ["webhooks"] },
      config: { rawBody: true },
      // Parse body as raw buffer for signature verification, then as JSON
      preHandler: async (request, reply) => {
        const secret = optionalEnv("GITHUB_WEBHOOK_SECRET", "");
        if (!secret) {
          logger.error("GITHUB_WEBHOOK_SECRET not configured — rejecting webhook");
          return reply.status(503).send({ error: "Webhook verification not configured" });
        }

        const signature = request.headers["x-hub-signature-256"] as string | undefined;
        if (!signature) {
          return reply.status(401).send({ error: "Missing signature" });
        }

        const rawBody = JSON.stringify(request.body);
        if (!verifyGitHubSignature(rawBody, signature, secret)) {
          logger.warn("invalid GitHub webhook signature");
          return reply.status(401).send({ error: "Invalid signature" });
        }
      },
    },
    async (request, reply) => {
      const eventType = (request.headers["x-github-event"] as string) ?? "unknown";
      const deliveryId = (request.headers["x-github-delivery"] as string) ?? undefined;
      const payload = request.body as Record<string, unknown>;

      const { type, summary } = summarizeGitHubEvent(eventType, payload);

      logger.info({ eventType, type, deliveryId, summary }, "received GitHub webhook");

      // Store in events table
      const event = await createEvent(app.db, {
        source: "github",
        type,
        payload: {
          githubEvent: eventType,
          deliveryId,
          summary,
          ...payload,
        },
      });

      // Only trigger autonomous processing for actionable events
      if (isActionableEvent(type)) {
        processEvent(app.db, app.llmRegistry, event, app.embeddingService, app.sandboxService, app.workspaceService, app.messagingService).catch(
          (err) => {
            logger.error({ err, eventId: event.id }, "background GitHub event processing failed");
          },
        );
      } else {
        logger.info({ eventId: event.id, type }, "non-actionable event logged (no session created)");
      }

      return reply.status(202).send({
        eventId: event.id,
        type,
        summary,
        status: isActionableEvent(type) ? "processing" : "logged",
      });
    },
  );
};
