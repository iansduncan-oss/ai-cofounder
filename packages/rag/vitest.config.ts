import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "rag", include: ["src/**/*.test.ts"] },
});
