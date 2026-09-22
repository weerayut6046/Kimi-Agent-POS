import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { staffBranches, staffUsers } from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";

let test: TestDb;

beforeAll(async () => {
  test = await setupTestDb();
});

afterAll(() => test.cleanup());

describe("staff PIN uniqueness", () => {
  it("rejects a new account PIN that matches a legacy PIN in the branch", async () => {
    await expect(
      test.caller("admin").auth.createStaff({
        username: "legacyduplicate",
        pin: "2222",
        name: "Legacy duplicate",
        role: "cashier",
        branchIds: [1],
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects a reset PIN that matches a legacy PIN in the branch", async () => {
    await expect(
      test.caller("admin").auth.updateStaff({ id: 3, pin: "2222" })
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await test.caller("admin").auth.updateStaff({ id: 3, pin: "1357" });
    const updated = await test.db.query.staffUsers.findFirst({
      where: eq(staffUsers.id, 3),
      columns: { pin: true },
    });
    expect(updated?.pin).toMatch(/^staff-pin-hmac-v1:/);
  });

  it("allows editing a legacy account without changing its already-shared PIN", async () => {
    const admin = await test.db.query.staffUsers.findFirst({
      where: eq(staffUsers.id, 1),
      columns: { pin: true },
    });
    const [other] = await test.db
      .insert(staffUsers)
      .values({
        username: "anotherlegacyadmin",
        pin: admin!.pin,
        name: "Another legacy admin",
        role: "admin",
      })
      .returning({ id: staffUsers.id });
    await test.db
      .insert(staffBranches)
      .values({ staffId: other!.id, branchId: 1 });

    await expect(
      test.caller("admin").auth.updateStaff({
        id: 1,
        name: "Updated admin",
        branchIds: [1],
      })
    ).resolves.toEqual({ ok: true });

    await expect(
      test.caller("admin").auth.updateStaff({
        id: 1,
        pin: "1234",
        branchIds: [1],
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
