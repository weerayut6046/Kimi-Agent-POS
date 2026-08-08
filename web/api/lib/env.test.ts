import { describe, expect, it } from "vitest";
import { projectRefFromSupabaseUrl } from "./env";

describe("projectRefFromSupabaseUrl", () => {
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
