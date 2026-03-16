import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "discord-bot", include: ["src/**/*.test.ts"] },
});
