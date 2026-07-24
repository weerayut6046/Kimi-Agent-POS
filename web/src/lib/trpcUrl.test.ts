import { describe, expect, it } from "vitest";
import { resolveTrpcUrl } from "./trpcUrl";

describe("resolveTrpcUrl", () => {
  it("routes a packaged desktop app through its same-origin offline proxy", () => {
    expect(
      resolveTrpcUrl({
        isDesktop: true,
        isDev: false,
        supabaseUrl: "https://project.supabase.co",
      }),
    ).toBe("/api/trpc");
  });

  it("calls Supabase directly from the production web app", () => {
    expect(
      resolveTrpcUrl({
        isDesktop: false,
        isDev: false,
        supabaseUrl: "https://project.supabase.co/",
      }),
    ).toBe("https://project.supabase.co/functions/v1/pos-api");
  });

  it("keeps development requests on the Vite proxy", () => {
    expect(
      resolveTrpcUrl({
        isDesktop: false,
        isDev: true,
        supabaseUrl: "https://project.supabase.co",
      }),
    ).toBe("/api/trpc");
  });
});
