import type { FastifyPluginAsync } from "fastify";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { optionalEnv } from "@ai-cofounder/shared";

const VAULT_DIR = optionalEnv("VAULT_DIR", "/opt/jarvis-vault");

export const vaultRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/vault/daily/:date — read a daily note (YYYY-MM-DD)
  app.get<{ Params: { date: string } }>(
    "/daily/:date",
    { schema: { tags: ["vault"] } },
    async (request, reply) => {
      const { date } = request.params;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return reply.status(400).send({ error: "Date must be YYYY-MM-DD" });
      }
      try {
        const content = await readFile(join(VAULT_DIR, "daily", `${date}.md`), "utf-8");
        return { date, content };
      } catch {
        return reply.status(404).send({ error: "No daily note for this date" });
      }
    },
  );

  // GET /api/vault/daily — list available daily notes
  app.get("/daily", { schema: { tags: ["vault"] } }, async () => {
    try {
      const files = await readdir(join(VAULT_DIR, "daily"));
      const dates = files
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.replace(".md", ""))
        .sort()
        .reverse();
      return { dates };
    } catch {
      return { dates: [] };
    }
  });

  // GET /api/vault/:section — list files in a vault section (projects, decisions, people)
  app.get<{ Params: { section: string } }>(
    "/:section",
    { schema: { tags: ["vault"] } },
    async (request, reply) => {
      const { section } = request.params;
      const validSections = ["projects", "decisions", "people"];
      if (!validSections.includes(section)) {
        return reply.status(400).send({ error: `Section must be one of: ${validSections.join(", ")}` });
      }
      try {
        const files = await readdir(join(VAULT_DIR, section));
        return {
          section,
          files: files.filter((f) => f.endsWith(".md")).map((f) => f.replace(".md", "")),
        };
      } catch {
        return { section, files: [] };
      }
    },
  );

  // GET /api/vault/:section/:slug — read a specific vault file
  app.get<{ Params: { section: string; slug: string } }>(
    "/:section/:slug",
    { schema: { tags: ["vault"] } },
    async (request, reply) => {
      const { section, slug } = request.params;
      const validSections = ["projects", "decisions", "people", "daily"];
      if (!validSections.includes(section)) {
        return reply.status(400).send({ error: "Invalid section" });
      }
      // Prevent path traversal
      if (slug.includes("..") || slug.includes("/")) {
        return reply.status(400).send({ error: "Invalid slug" });
      }
      try {
        const content = await readFile(join(VAULT_DIR, section, `${slug}.md`), "utf-8");
        return { section, slug, content };
      } catch {
        return reply.status(404).send({ error: "File not found" });
      }
    },
  );
};
