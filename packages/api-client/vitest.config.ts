import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "api-client", include: ["src/**/*.test.ts"] },
});
