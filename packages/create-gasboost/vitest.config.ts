import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.spec.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "tests/**/*.e2e.spec.ts"],
  },
});
