import { describe, expect, it } from "vitest";
import { accessTokenFromStoredSupabaseSession } from "./supabase";

describe("accessTokenFromStoredSupabaseSession", () => {
  const nowMs = 1_800_000_000_000;
  const nowSeconds = Math.floor(nowMs / 1000);

  it("returns a valid persisted access token", () => {
    expect(
      accessTokenFromStoredSupabaseSession(
        JSON.stringify({
          access_token: "signed-access-token",
          expires_at: nowSeconds + 3_600,
        }),
        nowMs
      )
    ).toBe("signed-access-token");
  });

  it("rejects expired, nearly expired, and malformed sessions", () => {
    expect(
      accessTokenFromStoredSupabaseSession(
        JSON.stringify({
          access_token: "expired",
          expires_at: nowSeconds,
        }),
        nowMs
      )
    ).toBeNull();
    expect(
      accessTokenFromStoredSupabaseSession(
        JSON.stringify({
          access_token: "nearly-expired",
          expires_at: nowSeconds + 20,
        }),
        nowMs
      )
    ).toBeNull();
    expect(accessTokenFromStoredSupabaseSession("not-json", nowMs)).toBeNull();
  });
});
