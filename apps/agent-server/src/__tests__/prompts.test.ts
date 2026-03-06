import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

const mockGetActivePrompt = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  createDb: vi.fn().mockReturnValue({}),
  getActivePrompt: (...args: unknown[]) => mockGetActivePrompt(...args),
}));

const { buildSystemPrompt } = await import("../agents/prompts/system.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildSystemPrompt", () => {
  describe("without DB (hardcoded prompts)", () => {
    it("returns a prompt string", async () => {
      const prompt = await buildSystemPrompt();
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(100);
    });

    it("includes core personality section", async () => {
      const prompt = await buildSystemPrompt();
      expect(prompt).toContain("AI Co-Founder");
      expect(prompt).toContain("personality");
    });

    it("includes capabilities section", async () => {
      const prompt = await buildSystemPrompt();
      expect(prompt).toContain("What you can do");
      expect(prompt).toContain("Think through problems");
      expect(prompt).toContain("Create plans");
      expect(prompt).toContain("Remember things");
      expect(prompt).toContain("Search the web");
      expect(prompt).toContain("Trigger automations");
    });

    it("includes specialist agents section", async () => {
      const prompt = await buildSystemPrompt();
      expect(prompt).toContain("specialist agents");
      expect(prompt).toContain("researcher");
      expect(prompt).toContain("coder");
      expect(prompt).toContain("reviewer");
      expect(prompt).toContain("planner");
    });

    it("includes behavioral guidelines", async () => {
      const prompt = await buildSystemPrompt();
      expect(prompt).toContain("How to behave");
      expect(prompt).toContain("request_approval");
    });

    it("does not include memory context when not provided", async () => {
      const prompt = await buildSystemPrompt();
      expect(prompt).not.toContain("What you know about your co-founder");
    });

    it("does not call getActivePrompt when db is not provided", async () => {
      await buildSystemPrompt();
      expect(mockGetActivePrompt).not.toHaveBeenCalled();
    });
  });

  describe("with memory context", () => {
    it("appends memory context section", async () => {
      const prompt = await buildSystemPrompt("User prefers TypeScript and uses NeoVim.");
      expect(prompt).toContain("What you know about your co-founder");
      expect(prompt).toContain("User prefers TypeScript and uses NeoVim.");
    });

    it("places memory context at the end of the prompt", async () => {
      const memoryText = "Their name is Ian and they like Fastify.";
      const prompt = await buildSystemPrompt(memoryText);
      const memoryIndex = prompt.indexOf("What you know about your co-founder");
      // Memory section should be in the latter portion of the prompt
      expect(memoryIndex).toBeGreaterThan(prompt.length / 2);
    });

    it("does not include memory section for empty string", async () => {
      const prompt = await buildSystemPrompt("");
      expect(prompt).not.toContain("What you know about your co-founder");
    });

    it("does not include memory section for undefined", async () => {
      const prompt = await buildSystemPrompt(undefined);
      expect(prompt).not.toContain("What you know about your co-founder");
    });
  });

  describe("with DB (prompt versioning)", () => {
    const mockDb = {} as any;

    it("queries DB for all three prompt sections", async () => {
      mockGetActivePrompt.mockResolvedValue(null);

      await buildSystemPrompt(undefined, mockDb);

      expect(mockGetActivePrompt).toHaveBeenCalledTimes(3);
      expect(mockGetActivePrompt).toHaveBeenCalledWith(mockDb, "core_personality");
      expect(mockGetActivePrompt).toHaveBeenCalledWith(mockDb, "capabilities");
      expect(mockGetActivePrompt).toHaveBeenCalledWith(mockDb, "behavioral_guidelines");
    });

    it("uses DB content when available for core_personality", async () => {
      mockGetActivePrompt.mockImplementation(async (_db: any, name: string) => {
        if (name === "core_personality") {
          return { content: "Custom core personality from DB.", version: 2, isActive: true };
        }
        return null;
      });

      const prompt = await buildSystemPrompt(undefined, mockDb);

      expect(prompt).toContain("Custom core personality from DB.");
      // Should still contain default capabilities since DB returned null for those
      expect(prompt).toContain("What you can do");
    });

    it("uses DB content when available for capabilities", async () => {
      mockGetActivePrompt.mockImplementation(async (_db: any, name: string) => {
        if (name === "capabilities") {
          return { content: "## Custom Capabilities\n- Do everything", version: 1, isActive: true };
        }
        return null;
      });

      const prompt = await buildSystemPrompt(undefined, mockDb);

      expect(prompt).toContain("Custom Capabilities");
      expect(prompt).toContain("Do everything");
      // Default capabilities should not appear
      expect(prompt).not.toContain("What you can do");
    });

    it("uses DB content when available for behavioral_guidelines", async () => {
      mockGetActivePrompt.mockImplementation(async (_db: any, name: string) => {
        if (name === "behavioral_guidelines") {
          return { content: "## Custom Guidelines\n- Be nice", version: 3, isActive: true };
        }
        return null;
      });

      const prompt = await buildSystemPrompt(undefined, mockDb);

      expect(prompt).toContain("Custom Guidelines");
      expect(prompt).toContain("Be nice");
      // Default guidelines should not appear
      expect(prompt).not.toContain("How to behave");
    });

    it("replaces all three sections when DB has all prompts", async () => {
      mockGetActivePrompt.mockImplementation(async (_db: any, name: string) => {
        const map: Record<string, string> = {
          core_personality: "DB Core.",
          capabilities: "DB Capabilities.",
          behavioral_guidelines: "DB Guidelines.",
        };
        return map[name] ? { content: map[name], version: 1, isActive: true } : null;
      });

      const prompt = await buildSystemPrompt(undefined, mockDb);

      expect(prompt).toContain("DB Core.");
      expect(prompt).toContain("DB Capabilities.");
      expect(prompt).toContain("DB Guidelines.");
      // Defaults should all be replaced
      expect(prompt).not.toContain("AI Co-Founder");
      expect(prompt).not.toContain("What you can do");
      expect(prompt).not.toContain("How to behave");
    });

    it("falls back to hardcoded defaults when DB returns null", async () => {
      mockGetActivePrompt.mockResolvedValue(null);

      const promptWithDb = await buildSystemPrompt(undefined, mockDb);
      const promptWithoutDb = await buildSystemPrompt();

      // Should produce the same output when DB has no overrides
      expect(promptWithDb).toBe(promptWithoutDb);
    });

    it("combines DB prompts with memory context", async () => {
      mockGetActivePrompt.mockImplementation(async (_db: any, name: string) => {
        if (name === "core_personality") {
          return { content: "DB personality override.", version: 1, isActive: true };
        }
        return null;
      });

      const prompt = await buildSystemPrompt("User is named Ian.", mockDb);

      expect(prompt).toContain("DB personality override.");
      expect(prompt).toContain("What you know about your co-founder");
      expect(prompt).toContain("User is named Ian.");
    });
  });

  describe("prompt structure", () => {
    it("separates sections with blank lines", async () => {
      const prompt = await buildSystemPrompt();
      // Core, capabilities, and guidelines are separated by double newlines
      expect(prompt).toContain("\n\n");
      const sections = prompt.split("\n\n");
      expect(sections.length).toBeGreaterThanOrEqual(3);
    });

    it("has a consistent format between DB and default prompts", async () => {
      const mockDb = {} as any;
      mockGetActivePrompt.mockImplementation(async (_db: any, name: string) => {
        const map: Record<string, string> = {
          core_personality: "Core section.",
          capabilities: "Caps section.",
          behavioral_guidelines: "Guide section.",
        };
        return map[name] ? { content: map[name], version: 1, isActive: true } : null;
      });

      const prompt = await buildSystemPrompt("memory data", mockDb);

      // Format: core \n\n capabilities \n\n guidelines \n\n memory
      expect(prompt).toBe(
        "Core section.\n\nCaps section.\n\nGuide section.\n\n## What you know about your co-founder:\nmemory data",
      );
    });
  });
});
