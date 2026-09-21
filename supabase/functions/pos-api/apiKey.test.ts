import { describe, expect, it } from "vitest";
import { projectApiKeyStatus } from "./apiKey";

function env(values: Record<string, string | undefined>) {
  return (name: string) => values[name];
}

function request(apikey?: string): Request {
  return new Request("https://project.supabase.co/functions/v1/pos-api/ping", {
    headers: apikey ? { apikey } : undefined,
  });
}

describe("pos-api project API key", () => {
  it("accepts a configured publishable key without a user JWT", () => {
    expect(
      projectApiKeyStatus(
        request("sb_publishable_web"),
        env({
          SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({
            default: "sb_publishable_web",
          }),
        })
      )
    ).toBe("ok");
  });

  it("supports the legacy anon key during migration", () => {
    expect(
      projectApiKeyStatus(
        request("legacy-anon-key"),
        env({ SUPABASE_ANON_KEY: "legacy-anon-key" })
      )
    ).toBe("ok");
  });

  it("rejects missing and unknown keys", () => {
    const readEnv = env({ SUPABASE_PUBLISHABLE_KEY: "expected-key" });
    expect(projectApiKeyStatus(request(), readEnv)).toBe("missing");
    expect(projectApiKeyStatus(request("wrong-key"), readEnv)).toBe("invalid");
  });

  it("fails closed when no public API key is configured", () => {
    expect(
      projectApiKeyStatus(
        request("sb_secret_must_not_be_accepted"),
        env({ SUPABASE_SECRET_KEY: "sb_secret_must_not_be_accepted" })
      )
    ).toBe("unconfigured");
  });
});
