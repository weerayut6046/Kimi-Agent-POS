import { afterEach, describe, expect, it, vi } from "vitest";

const staff = {
  id: 1,
  name: "Test staff",
  username: "teststaff",
  role: "cashier",
} as const;

function requestWithLocalSession(token: string): Request {
  return new Request("https://test.local/api", {
    headers: { "x-staff-session": token },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("local staff sessions", () => {
  it("rejects a previously accepted signed token in a production runtime", async () => {
    const testRuntime = await import("./session");
    const token = testRuntime.issueStaffSession(staff);
    expect(
      testRuntime.staffSessionFromHeader(requestWithLocalSession(token))
    ).toMatchObject(staff);

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOCAL_AUTH_ENABLED", "true");
    vi.resetModules();
    const productionRuntime = await import("./session");
    expect(
      productionRuntime.staffSessionFromHeader(requestWithLocalSession(token))
    ).toBeNull();
  });
});
