import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { createDb, type Db } from "@ai-cofounder/db";
import { requireEnv } from "@ai-cofounder/shared";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
  }
}

export const dbPlugin = fp(async (app: FastifyInstance) => {
  const db = createDb(requireEnv("DATABASE_URL"));
  app.decorate("db", db);
});
