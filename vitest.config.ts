import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/src/**/*.test.ts"],
    exclude: ["**/dist/**", "**/node_modules/**"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "lcov"],
      include: [
        "apps/*/src/**/*.ts",
        "packages/*/src/**/*.ts",
      ],
      exclude: [
        "**/__tests__/**",
        "**/dist/**",
        "**/node_modules/**",
        "**/*.test.ts",
        "**/index.ts",
      ],
      thresholds: {
        lines: 60,
        functions: 55,
        branches: 50,
        statements: 60,
      },
    },
  },
});
