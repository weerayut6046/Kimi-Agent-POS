import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { bangkokDateKey } from "@contracts/promotion";
import {
  branches,
  products,
  shiftReadings,
  shifts,
  staffBranches,
  staffUsers,
  tankRefills,
  workSchedules,
} from "@db/schema";
import type { StaffSessionClaims } from "../lib/session";
import { setupTestDb, type TestDb } from "../test/testDb";

const { getClaims } = vi.hoisted(() => ({ getClaims: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { getClaims } }),
}));

let test: TestDb;
let appRouter: typeof import("../router").appRouter;
let issueStaffSession: typeof import("../lib/session").issueStaffSession;
let otherBranchId: number;

beforeAll(async () => {
  vi.stubEnv("PUMPPOS_DEPLOYMENT_MODE", "business");
  vi.stubEnv("SUPABASE_URL", "https://unit-test.supabase.co");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "unit-test-key");
  test = await setupTestDb();
  ({ appRouter } = await import("../router"));
  ({ issueStaffSession } = await import("../lib/session"));
  const [otherBranch] = await test.db
    .insert(branches)
    .values({ code: "RBAC2", name: "Second test branch" })
    .returning({ id: branches.id });
  otherBranchId = otherBranch.id;
});

afterAll(async () => {
  await test?.cleanup();
  vi.unstubAllEnvs();
});

function callerWithHeaders(headers: Record<string, string>) {
  return appRouter.createCaller({
    req: new Request("https://test.local/api", { headers }),
    resHeaders: new Headers(),
  });
}

function staffById(id: number) {
  return test.db.query.staffUsers.findFirst({ where: eq(staffUsers.id, id) });
}

async function createFixtureStaff(
  role: StaffSessionClaims["role"],
  username: string,
  branchId: number
) {
  const [staff] = await test.db
    .insert(staffUsers)
    .values({ role, username, name: username, pin: "pending" })
    .returning({ id: staffUsers.id });
  await test.db
    .insert(staffBranches)
    .values({ staffId: staff.id, branchId, isDefault: true });
  return staff.id;
}

describe("RBAC session and financial gates", () => {
  it("denies anonymous and expired local sessions on a financial endpoint", async () => {
    const owner = await staffById(1);
    const now = Date.now();
    const clock = vi.spyOn(Date, "now");
    clock.mockReturnValue(now - 13 * 60 * 60 * 1000);
    let token: string;
    try {
      token = issueStaffSession({
        id: owner!.id,
        name: owner!.name,
        username: owner!.username,
        role: owner!.role,
      });
    } finally {
      clock.mockRestore();
    }

    await expect(
      test.anonymousCaller().fuelCosting.openings()
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      callerWithHeaders({ "x-staff-session": token }).fuelCosting.openings()
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(test.caller("admin").fuelCosting.openings()).resolves.toEqual(
      expect.any(Array)
    );
  });

  it("uses current account status, role and branch for each verified bearer request", async () => {
    const staffId = await createFixtureStaff("manager", "bearerfixture", 1);
    const authUserId = randomUUID();
    await test.db
      .update(staffUsers)
      .set({ supabaseAuthUserId: authUserId })
      .where(eq(staffUsers.id, staffId));
    const nowSeconds = Math.floor(Date.now() / 1000);
    const claims = {
      sub: authUserId,
      session_id: randomUUID(),
      exp: nowSeconds + 3600,
    };
    getClaims.mockResolvedValue({ data: { claims }, error: null });
    const bearer = { authorization: "Bearer verified-fixture" };
    await expect(
      callerWithHeaders(bearer).auth.currentStaff()
    ).resolves.toMatchObject({ id: staffId, role: "manager", branchId: 1 });
    getClaims.mockResolvedValueOnce({
      data: { claims: { ...claims, exp: nowSeconds - 1 } },
      error: null,
    });
    await expect(
      callerWithHeaders(bearer).auth.currentStaff()
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      callerWithHeaders({
        ...bearer,
        "x-branch-id": String(otherBranchId),
      }).auth.currentStaff()
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    // Direct database updates represent changes applied by a different API
    // instance, where this process would not receive cache invalidations.
    await test.db
      .update(staffUsers)
      .set({ role: "cashier" })
      .where(eq(staffUsers.id, staffId));
    await expect(
      callerWithHeaders(bearer).auth.currentStaff()
    ).resolves.toMatchObject({ id: staffId, role: "cashier", branchId: 1 });
    await test.db
      .update(staffUsers)
      .set({ active: false })
      .where(eq(staffUsers.id, staffId));
    await expect(
      callerWithHeaders(bearer).auth.currentStaff()
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(getClaims).toHaveBeenCalledWith("verified-fixture", {});
  });

  it.each(["manager", "cashier"] as const)(
    "denies %s the cost ledger and profit report",
    async role => {
      const caller = test.caller(role);
      await expect(caller.fuelCosting.openings()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        caller.fuelCosting.report({ from: "2026-01-01", to: "2026-01-31" })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  );

  it("keeps catalog and delivery details usable while redacting stored costs", async () => {
    const product = await test.db.query.products.findFirst({
      where: eq(products.code, "GSH95"),
    });
    const tank = await test.db.query.fuelTanks.findFirst();
    const [refill] = await test.db
      .insert(tankRefills)
      .values({
        branchId: 1,
        tankId: tank!.id,
        liters: 50,
        costPerLiter: 37,
        netCostAmount: 1850,
        note: "Purchase cost fixture",
      })
      .returning();

    expect(product!.cost).toBeGreaterThan(0);
    for (const role of ["admin", "manager", "cashier"] as const) {
      const caller = test.caller(role);
      const catalog = await caller.catalog.listProducts();
      expect(catalog.find(row => row.id === product!.id)).toMatchObject({
        price: product!.price,
        cost: role === "admin" ? product!.cost : 0,
      });
      const deliveries = await caller.catalog.listRefills();
      expect(deliveries.find(row => row.id === refill.id)).toMatchObject({
        liters: refill.liters,
        costPerLiter: role === "admin" ? refill.costPerLiter : 0,
        netCostAmount: role === "admin" ? refill.netCostAmount : null,
        note: role === "admin" ? refill.note : null,
      });
    }
    expect(
      await test.db.query.tankRefills.findFirst({
        where: eq(tankRefills.id, refill.id),
      })
    ).toEqual(refill);
    expect(
      await test.db.query.products.findFirst({
        where: eq(products.id, product!.id),
      })
    ).toEqual(product);
  });
});

describe("RBAC account administration", () => {
  it("rejects staff administration when the Manager lacks the required menus", async () => {
    const managerId = await createFixtureStaff("manager", "limitedmanager", 1);
    await test.db
      .update(staffUsers)
      .set({ menuPermissions: ["pos"] })
      .where(eq(staffUsers.id, managerId));
    const manager = callerWithHeaders({
      "x-staff-session": issueStaffSession({
        id: managerId,
        name: "limitedmanager",
        role: "manager",
        username: "limitedmanager",
      }),
    });
    await expect(
      manager.auth.createStaff({
        username: "restrictedfixture",
        name: "Restricted fixture",
        pin: "1734",
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "สิทธิ์ไม่เพียงพอสำหรับเมนูที่ร้องขอ",
    });
    await expect(manager.auth.listStaffAccess()).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "สิทธิ์ไม่เพียงพอสำหรับเมนูที่ร้องขอ",
    });
  });

  it("lets a Manager create and maintain Staff in its branch", async () => {
    const manager = test.caller("manager");
    await expect(
      manager.auth.createStaff({
        username: "managedfixture",
        name: "Managed staff",
        pin: "7384",
      })
    ).resolves.toEqual({ ok: true });
    const created = await test.db.query.staffUsers.findFirst({
      where: eq(staffUsers.username, "managedfixture"),
    });
    expect(created?.role).toBe("cashier");
    expect(
      await test.db.query.staffBranches.findMany({
        where: eq(staffBranches.staffId, created!.id),
      })
    ).toEqual([expect.objectContaining({ branchId: 1, isDefault: true })]);
    await expect(
      manager.auth.updateStaff({ id: created!.id, name: "Edited staff" })
    ).resolves.toEqual({ ok: true });
    expect(await staffById(created!.id)).toMatchObject({
      name: "Edited staff",
    });
    await expect(
      manager.auth.deleteStaff({ id: created!.id })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await staffById(created!.id)).toBeDefined();
  });

  it("rejects Manager privilege changes and cross-branch account IDs", async () => {
    const manager = test.caller("manager");
    const peerManagerId = await createFixtureStaff("manager", "peermanager", 1);
    const foreignStaffId = await createFixtureStaff(
      "cashier",
      "foreignstaff",
      otherBranchId
    );
    const crossBranchStaffId = await createFixtureStaff(
      "cashier",
      "multibranchstaff",
      1
    );
    await test.db.insert(staffBranches).values({
      staffId: crossBranchStaffId,
      branchId: otherBranchId,
    });
    const visible = (await manager.auth.listStaffAccess()).map(user => user.id);
    expect(visible).toContain(3);
    expect(visible).not.toContain(1);
    expect(visible).not.toContain(peerManagerId);
    expect(visible).not.toContain(foreignStaffId);
    expect(visible).not.toContain(crossBranchStaffId);

    const newStaff = {
      username: "deniedfixture",
      name: "Denied fixture",
      pin: "9327",
    };
    const forbiddenCreates: Partial<
      Parameters<typeof manager.auth.createStaff>[0]
    >[] = [
      { role: "admin" },
      { role: "manager" },
      { branchIds: [otherBranchId] },
      { menuPermissions: ["settings"] },
    ];
    for (const overrides of forbiddenCreates) {
      await expect(
        manager.auth.createStaff({ ...newStaff, ...overrides })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(
      await test.db.query.staffUsers.findFirst({
        where: eq(staffUsers.username, newStaff.username),
      })
    ).toBeUndefined();

    const affectedIds = [
      2,
      3,
      peerManagerId,
      foreignStaffId,
      crossBranchStaffId,
    ];
    const before = await Promise.all(affectedIds.map(staffById));
    const forbiddenUpdates: Parameters<typeof manager.auth.updateStaff>[0][] = [
      { id: 2, role: "admin" },
      { id: 3, role: "manager" },
      { id: 3, role: "admin" },
      { id: 3, menuPermissions: ["settings"] },
      { id: 3, accessGroupId: null },
      { id: 3, branchIds: [otherBranchId] },
      { id: peerManagerId, active: false },
      { id: foreignStaffId, active: false },
      { id: crossBranchStaffId, active: false },
    ];
    for (const patch of forbiddenUpdates) {
      await expect(manager.auth.updateStaff(patch)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
    await expect(
      test.caller("cashier").auth.updateStaff({ id: 3, role: "admin" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await Promise.all(affectedIds.map(staffById))).toEqual(before);
  });

  it("keeps the final active Owner and permits Owner management of Managers", async () => {
    const owner = test.caller("admin");
    const before = await staffById(1);
    await expect(
      owner.auth.updateStaff({ id: 1, active: false })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      owner.auth.updateStaff({ id: 1, role: "manager" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await staffById(1)).toEqual(before);

    const managerId = await createFixtureStaff("manager", "managedmanager", 1);
    await expect(
      owner.auth.updateStaff({ id: managerId, name: "Updated Manager" })
    ).resolves.toEqual({ ok: true });
    expect(await staffById(managerId)).toMatchObject({
      role: "manager",
      name: "Updated Manager",
    });
  });

  it("preserves one active Owner when two Owner removals are requested together", async () => {
    const secondOwnerId = await createFixtureStaff("admin", "secondowner", 1);
    const secondOwner = callerWithHeaders({
      "x-staff-session": issueStaffSession({
        id: secondOwnerId,
        name: "secondowner",
        role: "admin",
        username: "secondowner",
      }),
    });

    try {
      const outcomes = await Promise.allSettled([
        test.caller("admin").auth.updateStaff({ id: 1, active: false }),
        secondOwner.auth.updateStaff({ id: secondOwnerId, role: "manager" }),
      ]);
      expect(outcomes.filter(result => result.status === "fulfilled")).toEqual([
        { status: "fulfilled", value: { ok: true } },
      ]);
      expect(outcomes.filter(result => result.status === "rejected")).toEqual([
        expect.objectContaining({
          reason: expect.objectContaining({ code: "FORBIDDEN" }),
        }),
      ]);
      const staff = await Promise.all([staffById(1), staffById(secondOwnerId)]);
      expect(
        staff.filter(user => user?.active && user.role === "admin")
      ).toHaveLength(1);
    } finally {
      await test.db
        .update(staffUsers)
        .set({ active: true })
        .where(eq(staffUsers.id, 1));
      await test.db.delete(staffUsers).where(eq(staffUsers.id, secondOwnerId));
    }
  });
});

describe("RBAC shift records and approval", () => {
  it("preserves the sales shift while scoping meter, history and close actions", async () => {
    const staffId = 3;
    const nozzles = await test.db.query.nozzles.findMany();
    const template = await test.db.query.workShiftTemplates.findFirst();
    await test.db.insert(workSchedules).values({
      branchId: 1,
      staffId,
      shiftTemplateId: template!.id,
      workDate: bangkokDateKey(new Date()),
    });
    const [ownClosedShift, foreignShift] = await test.db
      .insert(shifts)
      .values([
        { branchId: 1, staffId, staffName: "Staff", status: "closed" },
        { branchId: otherBranchId, staffName: "Other branch", status: "open" },
      ])
      .returning({ id: shifts.id });
    const nozzle = nozzles[0]!;
    const nozzleProduct = await test.db.query.products.findFirst({
      where: eq(products.id, nozzle.productId),
    });
    await test.db.insert(shiftReadings).values({
      branchId: 1,
      shiftId: ownClosedShift.id,
      nozzleId: nozzle.id,
      openMeter: 200,
      closeMeter: 201,
      pricePerLiter: 40,
      costPerLiter: 37,
    });
    const { shiftId } = await test.caller("admin").pos.openShift({
      staffId,
      staffName: "Caller-supplied name",
      readings: nozzles.map(nozzle => ({
        nozzleId: nozzle.id,
        openMeter: nozzle.currentMeter,
        openMoney: nozzle.currentMoney,
      })),
    });
    const openShift = await test.db.query.shifts.findFirst({
      where: eq(shifts.id, shiftId),
    });
    expect(openShift).toMatchObject({ staffId: 1, status: "open" });
    expect(openShift?.staffName).not.toBe("Caller-supplied name");

    const staff = test.caller("cashier");
    const manager = test.caller("manager");
    await expect(staff.pos.currentShift()).resolves.toMatchObject({
      id: shiftId,
      readings: [],
      canSubmit: false,
    });
    const staffHistory = await staff.pos.shiftHistory();
    expect(staffHistory.map(shift => shift.id)).toEqual([ownClosedShift.id]);
    expect(nozzleProduct!.cost).toBeGreaterThan(0);
    for (const role of ["admin", "manager", "cashier"] as const) {
      await expect(
        test.caller(role).pos.shiftDetail({ id: ownClosedShift.id })
      ).resolves.toMatchObject({
        id: ownClosedShift.id,
        readings: [
          {
            openMeter: 200,
            closeMeter: 201,
            pricePerLiter: 40,
            costPerLiter: role === "admin" ? 37 : 0,
            product: { cost: role === "admin" ? nozzleProduct!.cost : 0 },
          },
        ],
      });
    }
    await expect(staff.pos.shiftDetail({ id: shiftId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      manager.pos.shiftDetail({ id: foreignShift.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const images = [
      { mimeType: "image/jpeg" as const, contentBase64: "/9j/4AAQ" },
    ];
    await expect(
      staff.pos.shiftMeterVerify({ shiftId, images })
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("ไม่พบกะที่เปิดอยู่"),
    });
    await expect(
      manager.pos.shiftMeterVerify({ shiftId: foreignShift.id, images })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    const close = {
      shiftId,
      readings: nozzles.map(nozzle => ({
        nozzleId: nozzle.id,
        closeMeter: nozzle.currentMeter,
        closeMoney: nozzle.currentMoney,
      })),
    };
    await expect(staff.pos.closeShift(close)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    await expect(
      manager.pos.closeShift({ ...close, shiftId: foreignShift.id })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(
      await test.db.query.shifts.findFirst({ where: eq(shifts.id, shiftId) })
    ).toEqual(openShift);

    await manager.pos.closeShift(close);
    expect(
      await test.db.query.shifts.findFirst({ where: eq(shifts.id, shiftId) })
    ).toMatchObject({ staffId: 1, status: "closed" });
    await expect(manager.pos.closeShift(close)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
});
