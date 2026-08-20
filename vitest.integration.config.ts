import { defineConfig } from "vitest/config";
import path from "node:path";

// Separate from vitest.config.ts (unit tests) because these need a real
// Postgres connection -- see README "Running integration tests against
// Postgres". Kept out of the default `pnpm test` run so unit tests stay
// fast and dependency-free.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./vitest.server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Integration tests share one database and must not run concurrently
    // against each other to avoid cross-test interference on shared
    // singleton rows (e.g. TicketNumberCounter).
    fileParallelism: false,
  },
});
