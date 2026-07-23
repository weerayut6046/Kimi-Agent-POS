import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { staffBranches } from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";

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
});
