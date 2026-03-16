import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "test-utils", include: ["src/**/*.test.ts"], passWithNoTests: true },
});
