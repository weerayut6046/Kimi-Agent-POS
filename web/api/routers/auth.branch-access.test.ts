import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { staffBranches, staffUsers } from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";
import * as connection from "../queries/connection";
import * as supabaseAuth from "../lib/supabaseAuth";

let test: TestDb;
let secondBranchId: number;

beforeAll(async () => {
  test = await setupTestDb();
  const created = await test.caller("admin").auth.createBranch({
    code: "ACCESS2",
    name: "สาขาทดสอบสิทธิ์",
    address: "",
    phone: "",
    taxId: "",
    cloneCurrentSetup: false,
  });
  secondBranchId = created.branch.id;

  // Preserve a legacy multi-branch membership to verify that non-admin
  // application access is still locked to the one default working branch.
  await test.db
    .insert(staffBranches)
    .values({
      staffId: 3,
      branchId: secondBranchId,
      isDefault: false,
    })
    .onConflictDoNothing();
});

afterAll(() => test.cleanup());

describe("staff branch access", () => {
  it("locks non-admin sessions to their default working branch", async () => {
    const cashier = test.caller("cashier", 3);

    const branches = await cashier.auth.listBranches();
    expect(branches.map(branch => branch.id)).toEqual([1]);

    await expect(
      cashier.auth.switchBranch({ branchId: secondBranchId })
    ).rejects.toThrow("เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถเปลี่ยนสาขาได้");

    await expect(
      test.caller("cashier", 3, secondBranchId).catalog.listProducts()
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("allows an admin to access and switch to any active branch", async () => {
    const admin = test.caller("admin");
    const branches = await admin.auth.listBranches();
    expect(branches.map(branch => branch.id)).toContain(secondBranchId);

    const switched = await admin.auth.switchBranch({
      branchId: secondBranchId,
    });
    expect(switched.branch.id).toBe(secondBranchId);
  });

  it("rejects a stale staff-creation branch before database access or Auth provisioning", async () => {
    const admin = test.caller("admin", 1, secondBranchId);
    // Finish the existing session checks before observing creation side effects.
    await admin.auth.currentStaff();
    const beforeStaff = await test.db.select().from(staffUsers);
    const beforeMemberships = await test.db.select().from(staffBranches);
    const database = vi.spyOn(connection, "getDb");
    const provision = vi
      .spyOn(supabaseAuth, "createSupabaseStaffIdentity")
      .mockRejectedValue(new Error("Unexpected Auth provisioning"));
    try {
      await expect(
        admin.auth.createStaff({
          username: "stalebranchstaff",
          name: "Stale branch staff",
          pin: "7264",
          role: "cashier",
          branchIds: [1],
          expectedBranchId: 1,
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(database).not.toHaveBeenCalled();
      expect(provision).not.toHaveBeenCalled();
    } finally {
      database.mockRestore();
      provision.mockRestore();
    }
    expect(await test.db.select().from(staffUsers)).toEqual(beforeStaff);
    expect(await test.db.select().from(staffBranches)).toEqual(
      beforeMemberships
    );
  });

  it("creates staff when the expected branch matches the active branch", async () => {
    await expect(
      test.caller("admin", 1, secondBranchId).auth.createStaff({
        username: "matchingbranchstaff",
        name: "Matching branch staff",
        pin: "7264",
        role: "cashier",
        branchIds: [secondBranchId],
        expectedBranchId: secondBranchId,
      })
    ).resolves.toEqual({ ok: true });
    const created = await test.db.query.staffUsers.findFirst({
      where: eq(staffUsers.username, "matchingbranchstaff"),
    });
    expect(created?.role).toBe("cashier");
    expect(created?.pin).toMatch(/^staff-pin-hmac-v1:/);
    expect(
      await test.db.query.staffBranches.findMany({
        where: eq(staffBranches.staffId, created!.id),
      })
    ).toEqual([
      expect.objectContaining({
        staffId: created!.id,
        branchId: secondBranchId,
        isDefault: true,
      }),
    ]);
  });

  it("preserves staff creation for existing clients that omit expectedBranchId", async () => {
    await expect(
      test.caller("admin").auth.createStaff({
        username: "legacybranchstaff",
        name: "Legacy branch client",
        pin: "8395",
        role: "manager",
      })
    ).resolves.toEqual({ ok: true });
    const created = await test.db.query.staffUsers.findFirst({
      where: eq(staffUsers.username, "legacybranchstaff"),
    });
    expect(created?.role).toBe("manager");
    expect(
      await test.db.query.staffBranches.findMany({
        where: eq(staffBranches.staffId, created!.id),
      })
    ).toEqual([
      expect.objectContaining({
        staffId: created!.id,
        branchId: 1,
        isDefault: true,
      }),
    ]);
  });
});
