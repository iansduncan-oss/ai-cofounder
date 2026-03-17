import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "agent-server",
    include: ["src/**/*.test.ts"],
    exclude: ["src/__tests__/integration/**"],
    setupFiles: ["src/__tests__/setup.ts"],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
