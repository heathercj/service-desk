import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./vitest.server-only-stub.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    env: {
      NODE_ENV: "test",
      DATABASE_URL:
        "postgresql://service_desk:service_desk_dev_password@localhost:5433/service_desk_test?schema=public",
      AUTH_SECRET: "test-only-not-a-real-secret-000000000000000",
      ENTRA_TENANT_ID: "11111111-1111-1111-1111-111111111111",
      ENABLE_DEV_AUTH: "false",
      // Forced off regardless of the developer's local .env -- the unit
      // suite must be deterministic, not depend on whichever flags happen
      // to be set for local manual testing. (Overriding ENABLE_DEV_AUTH
      // above without also pinning this tripped env.ts's own
      // ENABLE_DEMO_TOUR-requires-ENABLE_DEV_AUTH guard the first time any
      // module transitively imported env.ts in a unit test.)
      ENABLE_DEMO_TOUR: "false",
    },
    include: ["{src,scripts}/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**", "src/**/*.integration.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
