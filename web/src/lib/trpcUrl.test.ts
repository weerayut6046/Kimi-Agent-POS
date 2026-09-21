import { describe, expect, it } from "vitest";
import {
  resolveTrpcUrl,
  trpcAuthHeaders,
  usesSupabaseEdgeGateway,
} from "./trpcUrl";

describe("resolveTrpcUrl", () => {
  it("routes a packaged desktop app through its same-origin offline proxy", () => {
    expect(
      resolveTrpcUrl({
        isDesktop: true,
        isDev: false,
        supabaseUrl: "https://project.supabase.co",
      })
    ).toBe("/api/trpc");
  });

  it("calls Supabase directly from the production web app", () => {
    expect(
      resolveTrpcUrl({
        isDesktop: false,
        isDev: false,
        supabaseUrl: "https://project.supabase.co/",
      })
    ).toBe("https://project.supabase.co/functions/v1/pos-api");
  });

  it("keeps development requests on the Vite proxy", () => {
    expect(
      resolveTrpcUrl({
        isDesktop: false,
        isDev: true,
        supabaseUrl: "https://project.supabase.co",
      })
    ).toBe("/api/trpc");
  });

  it("identifies when development uses the Supabase Edge proxy", () => {
    expect(
      usesSupabaseEdgeGateway({
        isDesktop: false,
        isDev: true,
        supabaseUrl: "https://project.supabase.co",
        proxyToSupabaseInDev: true,
      })
    ).toBe(true);
    expect(
      usesSupabaseEdgeGateway({
        isDesktop: false,
        isDev: true,
        supabaseUrl: "https://project.supabase.co",
        proxyToSupabaseInDev: false,
      })
    ).toBe(false);
  });

  it("sends the publishable key without impersonating a signed-in user", () => {
    expect(
      trpcAuthHeaders({
        accessToken: null,
        publishableKey: "sb_publishable_test",
        usesSupabaseGateway: true,
      })
    ).toEqual({ apikey: "sb_publishable_test" });
  });

  it("adds the user JWT separately for authenticated requests", () => {
    expect(
      trpcAuthHeaders({
        accessToken: "user.jwt.value",
        publishableKey: "sb_publishable_test",
        usesSupabaseGateway: true,
      })
    ).toEqual({
      apikey: "sb_publishable_test",
      Authorization: "Bearer user.jwt.value",
    });
  });
});
