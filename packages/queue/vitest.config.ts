import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "queue", include: ["src/**/*.test.ts"] },
});
