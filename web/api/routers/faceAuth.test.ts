import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { staffUsers } from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";
import { hashStaffPin } from "../lib/staffPin";

let test: TestDb;
beforeAll(async () => {
  process.env.APP_SECRET = "test-".repeat(8);
  test = await setupTestDb();
  await test.db.update(staffUsers).set({ pin: hashStaffPin("2048") }).where(eq(staffUsers.id, 3));
});
afterAll(() => test.cleanup());

describe("PIN login without face or attendance", () => {
  it("logs in with username and PIN without creating attendance", async () => {
    const before = await test.db.query.attendanceSessions.findMany();
    const result = await test.anonymousCaller().faceAuth.beginFaceLogin({ username: "somchai", pin: "2048" });
    expect(result.requiresFace).toBe(false);
    expect(result.staff.id).toBe(3);
    const after = await test.db.query.attendanceSessions.findMany();
    expect(after).toHaveLength(before.length);
  });

  it("rejects biometric and enrollment procedures", async () => {
    await expect(test.caller("admin", 1).faceAuth.faceProfileList()).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
