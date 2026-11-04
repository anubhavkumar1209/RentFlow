import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "packages/*/test/**/*.test.ts", "apps/api/src/**/*.test.ts", "apps/web/test/**/*.test.ts"],
    // The RLS suite boots an in-process Postgres and runs all migrations.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
