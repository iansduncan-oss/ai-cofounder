import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "agent-server",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/__tests__/setup.ts"],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
