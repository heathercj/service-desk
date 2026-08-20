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
        "postgresql://service_desk:service_desk_dev_password@localhost:5432/service_desk_test?schema=public",
      AUTH_SECRET: "test-only-not-a-real-secret-000000000000000",
      ENTRA_TENANT_ID: "11111111-1111-1111-1111-111111111111",
      ENABLE_DEV_AUTH: "false",
    },
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**", "src/**/*.integration.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
