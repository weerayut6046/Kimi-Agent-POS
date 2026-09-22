import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { employeeFaceProfiles, staffUsers } from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";
import { hashStaffPin } from "../lib/staffPin";
import { faceAuthRouter } from "./faceAuth";

const embedding = (offset = 0) =>
  Array.from(
    { length: 128 },
    (_, index) => Math.sin(index * 0.17 + offset) * 0.12
  );
const samples = [embedding(), embedding(0.01), embedding(-0.01)];
const quality = {
  faceScore: 0.9,
  real: 0.91,
  live: 0.92,
  faceSize: 240,
  actionSatisfied: true as const,
};

let test: TestDb;
beforeAll(async () => {
  process.env.APP_SECRET = "test-".repeat(8);
  test = await setupTestDb();
  for (const [id, pin] of [
    [1, "4729"],
    [2, "6381"],
    [3, "2048"],
  ] as const) {
    await test.db
      .update(staffUsers)
      .set({ pin: hashStaffPin(pin) })
      .where(eq(staffUsers.id, id));
    await test.caller("admin", 1).faceAuth.enrollFace({
      staffId: id,
      embeddings: samples,
      consentConfirmed: true,
    });
  }
});
afterAll(() => test.cleanup());

describe("face login without attendance", () => {
  it("exposes only login and face enrollment procedures", () => {
    expect(Object.keys(faceAuthRouter._def.procedures).sort()).toEqual([
      "beginFaceLogin",
      "completeFaceLogin",
      "deleteFaceProfile",
      "enrollFace",
      "faceProfileList",
    ]);
  });

  it("stores an encrypted template for login and restricts enrollment to managers", async () => {
    const profile = await test.db.query.employeeFaceProfiles.findFirst({
      where: eq(employeeFaceProfiles.staffId, 3),
    });
    expect(profile?.templateEncrypted).toMatch(/^v1\./);
    expect(profile?.templateEncrypted).not.toContain(
      JSON.stringify(embedding())
    );
    await expect(
      test.caller("cashier", 3).faceAuth.enrollFace({
        staffId: 3,
        embeddings: samples,
        consentConfirmed: true,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it.each([
    ["admin", "admin", "4729", 1],
    ["manager", "manager", "6381", 2],
    ["cashier", "somchai", "2048", 3],
  ] as const)(
    "logs in a %s with PIN and face without clocking in",
    async (_role, username, pin, id) => {
      const anonymous = test.anonymousCaller();
      const before = await test.db.query.attendanceSessions.findMany();
      const challenge = await anonymous.faceAuth.beginFaceLogin({
        username,
        pin,
      });
      expect(challenge.token).toMatch(/^PUMPLOGINFACE1\./);
      const result = await anonymous.faceAuth.completeFaceLogin({
        challengeToken: challenge.token,
        embeddings: samples,
        quality,
      });
      expect(result.staff.id).toBe(id);
      expect(result.staff.sessionToken).toMatch(/\./);
      expect(result.authSession).toBeNull();
      const after = await test.db.query.attendanceSessions.findMany();
      expect(after).toHaveLength(before.length);
    }
  );

  it("rejects wrong PIN and wrong face", async () => {
    const anonymous = test.anonymousCaller();
    await expect(
      anonymous.faceAuth.beginFaceLogin({
        username: "somchai",
        pin: "9999",
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const challenge = await anonymous.faceAuth.beginFaceLogin({
      username: "somchai",
      pin: "2048",
    });
    const otherFace = Array.from({ length: 128 }, (_, index) =>
      index % 2 ? 1 : -1
    );
    await expect(
      anonymous.faceAuth.completeFaceLogin({
        challengeToken: challenge.token,
        embeddings: [otherFace, otherFace, otherFace],
        quality,
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("enforces the workforce menu permission on enrollment APIs", async () => {
    await test.db
      .update(staffUsers)
      .set({ menuPermissions: ["pos"] })
      .where(eq(staffUsers.id, 2));
    try {
      await expect(
        test.caller("manager", 2).faceAuth.faceProfileList()
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await test.db
        .update(staffUsers)
        .set({ menuPermissions: null })
        .where(eq(staffUsers.id, 2));
    }
  });
});
