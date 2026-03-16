import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "slack-bot", include: ["src/**/*.test.ts"] },
});
