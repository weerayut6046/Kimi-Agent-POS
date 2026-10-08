import { createHash } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";
import { loginAttempts, staffUsers } from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";
import { hashStaffPin } from "../lib/staffPin";
import { env } from "../lib/env";

const auth = vi.hoisted(() => ({ issue: vi.fn() }));
vi.mock("../lib/supabaseAuth", async original => ({
  ...(await original<typeof import("../lib/supabaseAuth")>()),
  issueSupabaseStaffSession: auth.issue,
}));

let test: TestDb;
beforeAll(async () => {
  test = await setupTestDb();
});
afterAll(() => test.cleanup());
beforeEach(async () => {
  auth.issue.mockReset();
  await test.db.delete(loginAttempts);
  await test.db
    .update(staffUsers)
    .set({ pin: hashStaffPin("2048"), active: true })
    .where(eq(staffUsers.id, 3));
});

describe("staff PIN login", () => {
  it("issues the normal staff session without creating attendance", async () => {
    const before = await test.db.query.attendanceSessions.findMany();
    const result = await test.anonymousCaller().staffAuth.loginWithPin({
      username: "SOMCHAI",
      pin: "2048",
    });
    expect(Object.keys(result).sort()).toEqual(["authSession", "staff"]);
    expect(result.staff).toMatchObject({
      id: 3,
      username: "somchai",
      branchId: 1,
    });
    expect(result.staff.sessionToken).toMatch(/\./);
    expect(result.authSession).toBeNull();
    const after = await test.db.query.attendanceSessions.findMany();
    expect(after).toHaveLength(before.length);
    expect(await test.db.query.loginAttempts.findMany()).toEqual([
      expect.objectContaining({
        username: "somchai",
        success: true,
        branchId: 1,
      }),
    ]);
  });

  it("rejects invalid credentials and records the failed attempt", async () => {
    await expect(
      test
        .anonymousCaller()
        .staffAuth.loginWithPin({ username: "somchai", pin: "1111" })
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "ชื่อผู้ใช้หรือ PIN ไม่ถูกต้อง",
    });
    expect(await test.db.query.loginAttempts.findMany()).toEqual([
      expect.objectContaining({ username: "somchai", success: false }),
    ]);
  });

  it("blocks repeated failed PIN attempts", async () => {
    for (let i = 0; i < 8; i += 1) {
      await expect(
        test
          .anonymousCaller()
          .staffAuth.loginWithPin({ username: "somchai", pin: "1111" })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
    await expect(
      test
        .anonymousCaller()
        .staffAuth.loginWithPin({ username: "somchai", pin: "2048" })
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(await test.db.query.loginAttempts.findMany()).toHaveLength(8);
  });

  it("rejects a deactivated staff account", async () => {
    await test.db
      .update(staffUsers)
      .set({ active: false })
      .where(eq(staffUsers.id, 3));
    await expect(
      test
        .anonymousCaller()
        .staffAuth.loginWithPin({ username: "somchai", pin: "2048" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("upgrades a valid historical PIN hash on login", async () => {
    await test.db
      .update(staffUsers)
      .set({ pin: createHash("sha256").update("2048").digest("hex") })
      .where(eq(staffUsers.id, 3));
    await test
      .anonymousCaller()
      .staffAuth.loginWithPin({ username: "somchai", pin: "2048" });
    expect(
      (
        await test.db.query.staffUsers.findFirst({
          where: eq(staffUsers.id, 3),
        })
      )?.pin
    ).toBe(hashStaffPin("2048"));
  });

  it("issues a Supabase session after PIN verification in production", async () => {
    const original = {
      isTest: env.isTest,
      localAuthEnabled: env.localAuthEnabled,
    };
    const authUserId = "11111111-1111-4111-8111-111111111111";
    const session = {
      accessToken: "approved-access",
      refreshToken: "approved-refresh",
      expiresAt: 2_000_000_000,
    };
    await test.db
      .update(staffUsers)
      .set({ supabaseAuthUserId: authUserId })
      .where(eq(staffUsers.id, 3));
    auth.issue.mockResolvedValue(session);
    env.isTest = false;
    env.localAuthEnabled = false;
    try {
      const result = await test
        .anonymousCaller()
        .staffAuth.loginWithPin({ username: "somchai", pin: "2048" });
      expect(result.authSession).toEqual(session);
      expect(result.staff).not.toHaveProperty("sessionToken");
      expect(auth.issue).toHaveBeenCalledWith("somchai", authUserId);
    } finally {
      Object.assign(env, original);
      await test.db
        .update(staffUsers)
        .set({ supabaseAuthUserId: null })
        .where(eq(staffUsers.id, 3));
    }
  });
});
