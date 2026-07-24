import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "web/src"),
      "@contracts": path.resolve(templateRoot, "web/contracts"),
      "@db": path.resolve(templateRoot, "web/db"),
    },
  },
  test: {
    environment: "node",
    env: {
      APP_ID: "pos-test",
      APP_SECRET: "test-only-session-secret-at-least-32-bytes",
      DATABASE_URL: "postgresql://test:test@localhost/test",
    },
    hookTimeout: 30_000,
    include: [
      "web/api/**/*.test.ts",
      "web/api/**/*.spec.ts",
      "web/src/**/*.test.ts",
      "desktop/**/*.test.ts",
      "supabase/functions/**/*.test.ts",
    ],
  },
});
