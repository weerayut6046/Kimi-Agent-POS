import { describe, expect, it, vi } from "vitest";
import { projectRefFromSupabaseUrl } from "./env";

describe("projectRefFromSupabaseUrl", () => {
  it("loads production readiness before a database connection has been configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("SUPABASE_DB_URL", "");
    try {
      vi.resetModules();
      const { env } = await import("./env");
      expect(env.isProduction).toBe(true);
      expect(env.databaseUrl).toBe("");
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
  it("reads the project ref from the default hosted Edge Function URL", () => {
    expect(
      projectRefFromSupabaseUrl("https://abcdefghijklmnopqrst.supabase.co")
    ).toBe("abcdefghijklmnopqrst");
  });

  it("accepts URL paths without including them in the project ref", () => {
    expect(
      projectRefFromSupabaseUrl(
        "https://abcdefghijklmnopqrst.supabase.co/functions/v1/pos-api"
      )
    ).toBe("abcdefghijklmnopqrst");
  });

  it("does not guess a project ref from custom or malformed URLs", () => {
    expect(projectRefFromSupabaseUrl("https://api.example.com")).toBe("");
    expect(projectRefFromSupabaseUrl("not-a-url")).toBe("");
    expect(projectRefFromSupabaseUrl(undefined)).toBe("");
  });
});
