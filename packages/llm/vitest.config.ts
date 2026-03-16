import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "llm", include: ["src/**/*.test.ts"] },
});
