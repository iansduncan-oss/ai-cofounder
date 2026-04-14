import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/src/**/*.test.ts"],
    exclude: ["**/dist/**", "**/node_modules/**"],
    passWithNoTests: true,
    testTimeout: 15000,
    hookTimeout: 15000,
    projects: [
      "packages/db",
      "packages/llm",
      "packages/shared",
      "packages/queue",
      "packages/rag",
      "packages/sandbox",
      "packages/api-client",
      "packages/bot-handlers",
      "packages/mcp-server",
      "apps/agent-server",
      "apps/discord-bot",
      "apps/slack-bot",
      "apps/dashboard",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "json-summary", "lcov"],
      reportsDirectory: "./coverage",
      include: ["apps/*/src/**/*.ts", "packages/*/src/**/*.ts"],
      exclude: [
        "**/__tests__/**",
        "**/dist/**",
        "**/node_modules/**",
        "**/*.test.ts",
        "**/index.ts",
      ],
      thresholds: {
        lines: 55,
        functions: 45,
        branches: 45,
        statements: 55,
      },
    },
  },
});
