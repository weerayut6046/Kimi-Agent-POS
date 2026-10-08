import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  generateLink: vi.fn(),
  verifyOtp: vi.fn(),
}));
vi.mock("./env", () => ({
  env: {
    supabaseUrl: "https://unit-test.supabase.co",
    supabaseSecretKey: "unit-server-key",
    supabasePublishableKey: "unit-client-key",
  },
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      admin: { generateLink: auth.generateLink },
      verifyOtp: auth.verifyOtp,
    },
  }),
}));

import { issueSupabaseStaffSession } from "./supabaseAuth";

const STAFF_AUTH_ID = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  auth.generateLink.mockReset();
  auth.verifyOtp.mockReset();
  auth.generateLink.mockResolvedValue({
    data: { properties: { hashed_token: "server-only-sign-in-token" } },
    error: null,
  });
  auth.verifyOtp.mockResolvedValue({
    data: {
      user: { id: STAFF_AUTH_ID },
      session: {
        access_token: "verified-access-token",
        refresh_token: "verified-refresh-token",
        expires_at: 2_000_000_000,
        expires_in: 3_600,
      },
    },
    error: null,
  });
});

describe("Supabase staff session issuance", () => {
  it("exchanges the one-time sign-in token on the server and returns the normal session", async () => {
    const session = await issueSupabaseStaffSession("somchai", STAFF_AUTH_ID);
    expect(auth.generateLink).toHaveBeenCalledWith({
      type: "magiclink",
      email: "somchai@staff.pumppos.invalid",
    });
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      token_hash: "server-only-sign-in-token",
      type: "email",
    });
    expect(session).toEqual({
      accessToken: "verified-access-token",
      refreshToken: "verified-refresh-token",
      expiresAt: 2_000_000_000,
    });
  });

  it("rejects a session issued for a different account", async () => {
    auth.verifyOtp.mockResolvedValueOnce({
      data: {
        user: { id: "different-staff" },
        session: { access_token: "unexpected-session" },
      },
      error: null,
    });
    await expect(
      issueSupabaseStaffSession("somchai", STAFF_AUTH_ID)
    ).rejects.toThrow("Unable to create staff sign-in session");
  });

  it("does not exchange a token when generation fails", async () => {
    auth.generateLink.mockResolvedValueOnce({
      data: {},
      error: { message: "Auth unavailable" },
    });
    await expect(
      issueSupabaseStaffSession("somchai", STAFF_AUTH_ID)
    ).rejects.toThrow("Auth unavailable");
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("rejects failed token verification", async () => {
    auth.verifyOtp.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { message: "Token expired" },
    });
    await expect(
      issueSupabaseStaffSession("somchai", STAFF_AUTH_ID)
    ).rejects.toThrow("Token expired");
  });
});
