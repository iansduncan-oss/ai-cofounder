import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { createLogger } from "@ai-cofounder/shared";
import { ProjectRegistryService } from "../services/project-registry.js";

const logger = createLogger("project-registry-plugin");

declare module "fastify" {
  interface FastifyInstance {
    projectRegistry: ProjectRegistryService;
  }
}

export const projectRegistryPlugin = fp(async (app: FastifyInstance) => {
  const registry = new ProjectRegistryService();

  if (app.db) {
    try {
      await registry.loadFromDb(app.db);
    } catch (err) {
      logger.error({ err }, "failed to load project registry from DB on startup");
    }
  }

  app.decorate("projectRegistry", registry);

  logger.info({ count: registry.listProjects().length }, "project registry plugin registered");
});
