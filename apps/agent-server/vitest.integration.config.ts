import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    name: "agent-server-integration",
    root: path.resolve(__dirname),
    include: ["src/__tests__/integration/**/*.integration.test.ts"],
    globalSetup: ["src/__tests__/integration/setup.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
