import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "bot-handlers", include: ["src/**/*.test.ts"] },
});
