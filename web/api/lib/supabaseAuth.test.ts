import { describe, expect, it, vi } from "vitest";
import {
  issueSupabaseStaffSessionWithAdapter,
  staffAuthBridgeFailureCode,
  type StaffAuthBridgeAdapter,
} from "./supabaseAuth";

const session = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresAt: 2_000_000_000,
};

function adapter(
  overrides: Partial<StaffAuthBridgeAdapter> = {}
): StaffAuthBridgeAdapter {
  return {
    getUserById: vi.fn(async () => null),
    findUserByEmail: vi.fn(async () => null),
    createUser: vi.fn(async (email: string) => ({ id: "auth-1", email })),
    updatePassword: vi.fn(async () => undefined),
    signIn: vi.fn(async () => session),
    linkStaff: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("Supabase staff Auth bridge", () => {
  it("creates and links an internal identity without returning its password", async () => {
    const bridge = adapter();
    const passwords = ["create-password", "signin-password"];

    const result = await issueSupabaseStaffSessionWithAdapter(
      { id: 1, supabaseAuthUserId: null },
      bridge,
      () => passwords.shift() ?? "fallback-password"
    );

    expect(result).toEqual(session);
    expect(bridge.createUser).toHaveBeenCalledWith(
      expect.stringMatching(/^staff-.+-1@auth\.pumppos\.invalid$/),
      "create-password"
    );
    expect(bridge.linkStaff).toHaveBeenCalledWith(1, "auth-1");
    expect(bridge.updatePassword).toHaveBeenCalledWith(
      "auth-1",
      "signin-password"
    );
    expect(JSON.stringify(result)).not.toContain("password");
  });

  it("recovers an existing deterministic identity after a stale link", async () => {
    const bridge = adapter({
      findUserByEmail: vi.fn(async email => ({ id: "auth-7", email })),
    });

    await issueSupabaseStaffSessionWithAdapter(
      { id: 7, supabaseAuthUserId: "deleted-auth-id" },
      bridge,
      () => "rotated-password"
    );

    expect(bridge.createUser).not.toHaveBeenCalled();
    expect(bridge.linkStaff).toHaveBeenCalledWith(7, "auth-7");
  });

  it("retries once if concurrent login rotates the internal password", async () => {
    let attempts = 0;
    const bridge = adapter({
      findUserByEmail: vi.fn(async email => ({ id: "auth-3", email })),
      signIn: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("concurrent rotation");
        return session;
      }),
    });

    await expect(
      issueSupabaseStaffSessionWithAdapter(
        { id: 3, supabaseAuthUserId: null },
        bridge,
        () => `password-${attempts}`
      )
    ).resolves.toEqual(session);
    expect(bridge.updatePassword).toHaveBeenCalledTimes(2);
    expect(bridge.signIn).toHaveBeenCalledTimes(2);
  });

  it("rejects a linked Auth identity with an unexpected email", async () => {
    const bridge = adapter({
      getUserById: vi.fn(async () => ({
        id: "wrong-auth-user",
        email: "another-user@example.com",
      })),
    });

    const error = await issueSupabaseStaffSessionWithAdapter(
      { id: 9, supabaseAuthUserId: "wrong-auth-user" },
      bridge
    ).catch(value => value as unknown);

    expect(staffAuthBridgeFailureCode(error)).toBe("identity_mismatch");
    expect(bridge.updatePassword).not.toHaveBeenCalled();
  });
});
