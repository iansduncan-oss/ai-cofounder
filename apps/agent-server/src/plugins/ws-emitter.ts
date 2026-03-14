import fp from "fastify-plugin";
import { createLogger } from "@ai-cofounder/shared";
import type { WsChannel } from "@ai-cofounder/shared";

const logger = createLogger("ws-emitter");

/**
 * WS Emitter Bridge — connects BullMQ worker completions, pub/sub events,
 * and internal app events to WS broadcast invalidations.
 *
 * Listens on app.agentEvents for well-known event names emitted by workers
 * and services, then calls app.wsBroadcast() to push invalidation to
 * subscribed dashboard clients.
 */
export const wsEmitterPlugin = fp(async (app) => {
  // Guard: wsBroadcast must be registered (websocketPlugin loaded first)
  if (typeof app.wsBroadcast !== "function") {
    logger.warn("wsBroadcast not available — ws-emitter disabled");
    return;
  }

  const emit = (channel: WsChannel) => {
    try {
      app.wsBroadcast(channel);
    } catch (err) {
      logger.warn({ err, channel }, "wsBroadcast failed (non-fatal)");
    }
  };

  // Listen for worker-emitted events on agentEvents
  // These are fired by the queue plugin workers after job completion
  app.agentEvents.on("ws:monitoring_complete", () => emit("monitoring"));
  app.agentEvents.on("ws:briefing_complete", () => emit("briefing"));
  app.agentEvents.on("ws:notification_complete", () => emit("queue"));
  app.agentEvents.on("ws:pipeline_complete", () => emit("pipelines"));
  app.agentEvents.on("ws:health_change", () => emit("health"));
  app.agentEvents.on("ws:task_change", () => emit("tasks"));
  app.agentEvents.on("ws:approval_change", () => emit("approvals"));
  app.agentEvents.on("ws:goal_change", () => emit("goals"));
  app.agentEvents.on("ws:queue_change", () => emit("queue"));
  app.agentEvents.on("ws:tool_stats_change", () => emit("tools"));
  app.agentEvents.on("ws:deploy_change", () => emit("deploys"));
  app.agentEvents.on("ws:pattern_change", () => emit("patterns"));

  logger.info("WS emitter bridge initialized");
});
