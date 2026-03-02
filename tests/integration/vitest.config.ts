import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 180_000,
    hookTimeout: 45_000,
    globals: true,
    sequence: {
      concurrent: false,
    },
    globalSetup: "./global-setup.ts",
    fileParallelism: false,
  },
});
