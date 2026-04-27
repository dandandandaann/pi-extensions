import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/internal.ts"],
      exclude: ["src/**/*.test.ts", "src/mocks.ts"],
      thresholds: {
        functions: 80,
        branches: 70,
        lines: 80,
        statements: 80,
      },
    },
  },
});