import { defineProject } from "vitest/config";
import path from "path";

export default defineProject({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    name: "dashboard",
    globals: true,
    environment: "jsdom",
    setupFiles: ["src/__tests__/setup.ts"],
    css: false,
    include: ["src/__tests__/**/*.test.{ts,tsx}"],
  },
});
