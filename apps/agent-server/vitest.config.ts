import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "agent-server",
    include: ["src/**/*.test.ts"],
    exclude: ["src/__tests__/integration/**"],
    setupFiles: ["src/__tests__/setup.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
