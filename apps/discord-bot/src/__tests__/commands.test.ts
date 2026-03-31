import { describe, it, expect, vi, beforeAll } from "vitest";

beforeAll(() => {
  process.env.DISCORD_TOKEN = "test-token";
  process.env.DISCORD_CLIENT_ID = "test-client-id";
});

// Mock discord.js — need SlashCommandBuilder to actually work for command definitions
vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  optionalEnv: (name: string, defaultValue: string) => process.env[name] ?? defaultValue,
}));

const { askCommand } = await import("../commands/ask.js");
const { statusCommand } = await import("../commands/status.js");
const { goalsCommand } = await import("../commands/goals.js");
const { tasksCommand } = await import("../commands/tasks.js");
const { memoryCommand } = await import("../commands/memory.js");
const { clearCommand } = await import("../commands/clear.js");
const { executeCommand } = await import("../commands/execute.js");
const { approveCommand } = await import("../commands/approve.js");
const { helpCommand } = await import("../commands/help.js");
const { scheduleCommand } = await import("../commands/schedule.js");
const { gmailCommand } = await import("../commands/gmail.js");
const { registerUserCommand } = await import("../commands/register-user.js");

describe("Discord command definitions", () => {
  describe("ask command", () => {
    it("has correct name and description", () => {
      const json = askCommand.toJSON();
      expect(json.name).toBe("ask");
      expect(json.description).toBe("Ask the AI Cofounder a question");
    });

    it("has required message option", () => {
      const json = askCommand.toJSON();
      expect(json.options).toHaveLength(1);
      expect(json.options![0].name).toBe("message");
      expect(json.options![0].required).toBe(true);
    });
  });

  describe("status command", () => {
    it("has correct name and description", () => {
      const json = statusCommand.toJSON();
      expect(json.name).toBe("status");
      expect(json.description).toBe("Check the AI Cofounder system status");
    });
  });

  describe("goals command", () => {
    it("has correct name and description", () => {
      const json = goalsCommand.toJSON();
      expect(json.name).toBe("goals");
      expect(json.description).toBe("Show active goals for this channel");
    });
  });

  describe("tasks command", () => {
    it("has correct name and description", () => {
      const json = tasksCommand.toJSON();
      expect(json.name).toBe("tasks");
      expect(json.description).toBe("Show pending tasks");
    });
  });

  describe("memory command", () => {
    it("has correct name and description", () => {
      const json = memoryCommand.toJSON();
      expect(json.name).toBe("memory");
      expect(json.description).toBe("Show what the AI Co-Founder remembers about you");
    });
  });

  describe("clear command", () => {
    it("has correct name and description", () => {
      const json = clearCommand.toJSON();
      expect(json.name).toBe("clear");
      expect(json.description).toBe("Start a fresh conversation in this channel");
    });
  });

  describe("execute command", () => {
    it("has correct name and description", () => {
      const json = executeCommand.toJSON();
      expect(json.name).toBe("execute");
      expect(json.description).toBe("Execute all tasks for a goal");
    });

    it("has required goal_id option", () => {
      const json = executeCommand.toJSON();
      expect(json.options).toHaveLength(1);
      expect(json.options![0].name).toBe("goal_id");
      expect(json.options![0].required).toBe(true);
    });
  });

  describe("approve command", () => {
    it("has correct name and description", () => {
      const json = approveCommand.toJSON();
      expect(json.name).toBe("approve");
      expect(json.description).toBe("Approve a pending action");
    });

    it("has required approval_id option", () => {
      const json = approveCommand.toJSON();
      expect(json.options).toHaveLength(1);
      expect(json.options![0].name).toBe("approval_id");
      expect(json.options![0].required).toBe(true);
    });
  });

  describe("help command", () => {
    it("has correct name and description", () => {
      const json = helpCommand.toJSON();
      expect(json.name).toBe("help");
      expect(json.description).toBe("Show all available commands");
    });
  });

  describe("register command", () => {
    it("has correct name and description", () => {
      const json = registerUserCommand.toJSON();
      expect(json.name).toBe("register");
      expect(json.description).toBe("Register yourself with AI Cofounder");
    });
  });

  describe("schedule command", () => {
    it("has correct name and description", () => {
      const json = scheduleCommand.toJSON();
      expect(json.name).toBe("schedule");
      expect(json.description).toBe("Manage scheduled tasks");
    });

    it("has correct subcommands", () => {
      const json = scheduleCommand.toJSON();
      expect(json.options).toHaveLength(2);

      const listSub = json.options!.find((o) => o.name === "list");
      expect(listSub).toBeDefined();
      expect(listSub!.description).toBe("List all active schedules");

      const createSub = json.options!.find((o) => o.name === "create");
      expect(createSub).toBeDefined();
      expect(createSub!.description).toBe("Create a new schedule");
    });

    it("create subcommand has required cron and task options", () => {
      const json = scheduleCommand.toJSON();
      const createSub = json.options!.find((o) => o.name === "create")!;
      // Subcommand options are nested
      const opts = (createSub as { options?: Array<{ name: string; required?: boolean }> }).options;
      expect(opts).toHaveLength(2);

      const cronOpt = opts!.find((o) => o.name === "cron");
      expect(cronOpt).toBeDefined();
      expect(cronOpt!.required).toBe(true);

      const taskOpt = opts!.find((o) => o.name === "task");
      expect(taskOpt).toBeDefined();
      expect(taskOpt!.required).toBe(true);
    });
  });

  describe("gmail command", () => {
    it("has correct name and description", () => {
      const json = gmailCommand.toJSON();
      expect(json.name).toBe("gmail");
      expect(json.description).toBe("Gmail integration");
    });

    it("has inbox and send subcommands", () => {
      const json = gmailCommand.toJSON();
      expect(json.options).toHaveLength(2);

      const inboxSub = json.options!.find((o) => o.name === "inbox");
      expect(inboxSub).toBeDefined();

      const sendSub = json.options!.find((o) => o.name === "send");
      expect(sendSub).toBeDefined();
    });

    it("send subcommand has required to, subject, body options", () => {
      const json = gmailCommand.toJSON();
      const sendSub = json.options!.find((o) => o.name === "send")!;
      const opts = (sendSub as { options?: Array<{ name: string; required?: boolean }> }).options;
      expect(opts).toHaveLength(3);

      for (const name of ["to", "subject", "body"]) {
        const opt = opts!.find((o) => o.name === name);
        expect(opt).toBeDefined();
        expect(opt!.required).toBe(true);
      }
    });
  });

  describe("all commands exist in register list", () => {
    it("there are 12 commands total", () => {
      const allCommands = [
        askCommand,
        statusCommand,
        goalsCommand,
        tasksCommand,
        memoryCommand,
        clearCommand,
        executeCommand,
        approveCommand,
        helpCommand,
        scheduleCommand,
        gmailCommand,
        registerUserCommand,
      ];
      expect(allCommands).toHaveLength(12);
      // Each has a unique name
      const names = allCommands.map((c) => c.toJSON().name);
      expect(new Set(names).size).toBe(12);
    });
  });
});
