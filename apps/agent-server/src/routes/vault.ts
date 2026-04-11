import type { FastifyPluginAsync } from "fastify";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { optionalEnv } from "@ai-cofounder/shared";

const VAULT_DIR = optionalEnv("VAULT_DIR", "/opt/jarvis-vault");

interface VaultDailyResponse {
  date: string;
  content: string;
}

interface VaultDailyListResponse {
  dates: string[];
}

interface VaultSectionListResponse {
  section: string;
  files: string[];
}

interface VaultFileResponse {
  section: string;
  slug: string;
  content: string;
}

interface VaultSearchMatch {
  section: string;
  slug: string;
  line: number;
  snippet: string;
}

interface VaultSearchResponse {
  query: string;
  matches: VaultSearchMatch[];
}

const VALID_SEARCH_SECTIONS = ["all", "daily", "projects", "decisions", "people"] as const;
type VaultSearchSection = (typeof VALID_SEARCH_SECTIONS)[number];

async function searchVaultFiles(
  query: string,
  section: VaultSearchSection,
  limit: number,
): Promise<VaultSearchMatch[]> {
  const needle = query.toLowerCase();
  const sectionsToScan: Exclude<VaultSearchSection, "all">[] =
    section === "all" ? ["daily", "projects", "decisions", "people"] : [section];

  const matches: VaultSearchMatch[] = [];
  for (const sec of sectionsToScan) {
    const dir = join(VAULT_DIR, sec);
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const slug = file.replace(/\.md$/, "");
      const filePath = join(dir, file);
      try {
        const fileStat = await stat(filePath);
        if (!fileStat.isFile()) continue;
      } catch {
        continue;
      }
      let content: string;
      try {
        content = await readFile(filePath, "utf-8");
      } catch {
        continue;
      }
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].toLowerCase().includes(needle)) continue;
        const start = Math.max(0, i - 1);
        const end = Math.min(lines.length, i + 2);
        matches.push({
          section: sec,
          slug,
          line: i + 1,
          snippet: lines.slice(start, end).join("\n"),
        });
        if (matches.length >= limit) return matches;
      }
    }
  }
  return matches;
}

export const vaultRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/vault/search?q=...&section=...&limit=... — search across vault files
  app.get<{
    Querystring: { q?: string; section?: string; limit?: string };
    Reply: VaultSearchResponse | { error: string };
  }>("/search", { schema: { tags: ["vault"] } }, async (request, reply) => {
    const q = (request.query.q ?? "").trim();
    if (!q) {
      return reply.status(400).send({ error: "Query parameter 'q' is required" });
    }
    const sectionParam = (request.query.section ?? "all") as VaultSearchSection;
    if (!VALID_SEARCH_SECTIONS.includes(sectionParam)) {
      return reply.status(400).send({
        error: `section must be one of: ${VALID_SEARCH_SECTIONS.join(", ")}`,
      });
    }
    const limit = Math.max(1, Math.min(100, Number(request.query.limit ?? 10)));
    const matches = await searchVaultFiles(q, sectionParam, limit);
    return { query: q, matches };
  });

  // GET /api/vault/daily/:date — read a daily note (YYYY-MM-DD)
  app.get<{ Params: { date: string }; Reply: VaultDailyResponse | { error: string } }>(
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
  app.get<{ Reply: VaultDailyListResponse }>(
    "/daily",
    { schema: { tags: ["vault"] } },
    async (): Promise<VaultDailyListResponse> => {
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
    },
  );

  // GET /api/vault/:section — list files in a vault section (projects, decisions, people)
  app.get<{
    Params: { section: string };
    Reply: VaultSectionListResponse | { error: string };
  }>("/:section", { schema: { tags: ["vault"] } }, async (request, reply) => {
    const { section } = request.params;
    const validSections = ["projects", "decisions", "people"];
    if (!validSections.includes(section)) {
      return reply
        .status(400)
        .send({ error: `Section must be one of: ${validSections.join(", ")}` });
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
  });

  // GET /api/vault/:section/:slug — read a specific vault file
  app.get<{
    Params: { section: string; slug: string };
    Reply: VaultFileResponse | { error: string };
  }>("/:section/:slug", { schema: { tags: ["vault"] } }, async (request, reply) => {
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
  });
};
