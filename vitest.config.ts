import { defineConfig } from "vitest/config";
// eslint-disable-next-line @typescript-eslint/no-require-imports
import path from "path";

const dashboardSrc = path.resolve(__dirname, "apps/dashboard/src");
const dashboardSetup = path.resolve(
  __dirname,
  "apps/dashboard/src/__tests__/setup.ts",
);

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/src/**/*.test.ts"],
    exclude: ["**/dist/**", "**/node_modules/**", "apps/dashboard/**"],
    passWithNoTests: true,
    testTimeout: 15000,
    projects: [
      {
        test: {
          name: "packages",
          globals: true,
          environment: "node",
          include: ["**/src/**/*.test.ts"],
          exclude: [
            "**/dist/**",
            "**/node_modules/**",
            "apps/dashboard/**",
          ],
          passWithNoTests: true,
          testTimeout: 15000,
          hookTimeout: 15000,
        },
      },
      {
        resolve: {
          alias: {
            "@": dashboardSrc,
          },
        },
        test: {
          name: "dashboard",
          globals: true,
          environment: "jsdom",
          setupFiles: [dashboardSetup],
          css: false,
          include: ["apps/dashboard/src/__tests__/**/*.test.{ts,tsx}"],
          exclude: ["**/dist/**", "**/node_modules/**"],
          testTimeout: 15000,
          hookTimeout: 15000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "lcov"],
      include: ["apps/*/src/**/*.ts", "packages/*/src/**/*.ts"],
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
